#![allow(clippy::all)]

use ckb_testtool::context::Context;
pub use ckb_tool::ckb_types::bytes::Bytes;
use ckb_tool::ckb_types::{core::Capacity, packed::*, prelude::*};
use core::convert::TryInto;
use force_eth_types::{
    eth_recipient_cell::ETHAddress,
    generated::{
        basic, eth_bridge_lock_cell::ETHBridgeLockArgs, eth_header_cell,
        eth_recipient_cell::ETHRecipientCellData, witness::MintTokenWitness,
    },
    hasher::Blake2bHasher,
};
use sparse_merkle_tree::{default_store::DefaultStore, SparseMerkleTree, H256};
use std::collections::HashMap;
use std::convert::TryFrom;
use std::vec::Vec;

pub const ETH_BRIDGE_LOCKSCRIPT_OUTPOINT_KEY: &str = "eth_bridge_lockscript_outpoint_key";
pub const ETH_BRIDGE_TYPESCRIPT_OUTPOINT_KEY: &str = "eth_bridge_typescript_outpoint_key";

pub const ETH_LIGHT_CLIENT_TYPESCRIPT_OUTPOINT_KEY: &str =
    "eth_light_client_typecript_outpoint_key";
pub const ETH_RECIPIENT_TYPESCRIPT_OUTPOINT_KEY: &str = "eth_recipient_typescript_outpoint_key";
pub const SUDT_TYPESCRIPT_OUTPOINT_KEY: &str = "sudt_typescript_key";
pub const ALWAYS_SUCCESS_OUTPOINT_KEY: &str = "always_success_outpoint_key";
pub const FIRST_INPUT_OUTPOINT_KEY: &str = "cell_id_outpoint_key";

pub const ETH_BRIDGE_INPUT_OUTPOINT: &str =
    "ce2af4461cc6062998febffea311866388e8c869af0cf89ce832dadcd3521f2700000000";

pub type OutpointsContext = HashMap<&'static str, OutPoint>;

pub trait CellBuilder {
    fn build_input_cell(
        &self,
        context: &mut Context,
        outpoints: &OutpointsContext,
    ) -> (OutPoint, CellInput);

    fn build_output_cell(
        &self,
        context: &mut Context,
        outpoints: &OutpointsContext,
    ) -> (Bytes, CellOutput);

    fn get_index(&self) -> usize;
}

pub struct TestCase {
    pub cell_deps: Vec<CellDepView>,
    pub script_cells: CustomCells,
    pub sudt_cells: SudtCells,
    pub capacity_cells: CapacityCells,
    pub witnesses: Vec<Witness>,
    pub expect_return_error_info: String,
}

pub struct CustomCells {
    pub inputs: Vec<CustomCell>,
    pub outputs: Vec<CustomCell>,
}

pub enum CustomCell {
    ETHRecipientCustomCell(ETHRecipientCell),
    ETHBridgeCustomCell(ETHBridgeCell),
}

impl CellBuilder for CustomCell {
    fn build_input_cell(
        &self,
        context: &mut Context,
        outpoints: &OutpointsContext,
    ) -> (OutPoint, CellInput) {
        match self {
            CustomCell::ETHBridgeCustomCell(eth_bridge_cell) => {
                eth_bridge_cell.build_input_cell(context, outpoints)
            }
            _ => {
                let (cell_data, cell) = self.build_output_cell(context, outpoints);
                let input_out_point = context.create_cell(cell, cell_data);
                let input_cell = CellInput::new_builder()
                    .previous_output(input_out_point.clone())
                    .build();
                (input_out_point, input_cell)
            }
        }
    }

    fn build_output_cell(
        &self,
        context: &mut Context,
        outpoints: &OutpointsContext,
    ) -> (Bytes, CellOutput) {
        match self {
            CustomCell::ETHRecipientCustomCell(eth_recipient_cell) => {
                eth_recipient_cell.build_output_cell(context, outpoints)
            }
            CustomCell::ETHBridgeCustomCell(eth_bridge_cell) => {
                eth_bridge_cell.build_output_cell(context, outpoints)
            }
        }
    }

    fn get_index(&self) -> usize {
        match self {
            CustomCell::ETHRecipientCustomCell(eth_recipient_cell) => eth_recipient_cell.index,
            CustomCell::ETHBridgeCustomCell(eth_bridge_cell) => eth_bridge_cell.index,
        }
    }
}

#[allow(dead_code)]
pub enum CellDepView {
    ETHBridgeLockCellDep(ETHBridgeLockDep),
}

impl CellDepView {
    pub fn build_cell_dep(&self, context: &mut Context, outpoints: &OutpointsContext) -> CellDep {
        match self {
            CellDepView::ETHBridgeLockCellDep(cell_dep) => {
                cell_dep.build_cell_dep(context, outpoints)
            }
        }
    }
}

pub struct ETHBridgeLockDep {
    pub start_height: u128,
    pub latest_height: u128,
    pub merkle_root: [u8; 32],
}

impl ETHBridgeLockDep {
    pub fn build_cell_dep(&self, context: &mut Context, outpoints: &OutpointsContext) -> CellDep {
        let data = eth_header_cell::ETHHeaderCellMerkleData::new_builder()
            .start_height((self.start_height.clone() as u64).into())
            .latest_height((self.latest_height.clone() as u64).into())
            .merkle_root(basic::Byte32::from_slice(self.merkle_root.clone().as_ref()).unwrap())
            .build();

        let light_client_typescript = context
            .build_script(
                &outpoints[ETH_LIGHT_CLIENT_TYPESCRIPT_OUTPOINT_KEY],
                Default::default(),
            )
            .expect("build eth light client typescript");

        let cell = CellOutput::new_builder()
            .type_(Some(light_client_typescript).pack())
            .capacity(Capacity::bytes(data.as_bytes().len()).unwrap().pack())
            .build();
        let data_out_point = context.create_cell(cell, data.as_bytes());
        CellDep::new_builder().out_point(data_out_point).build()
    }
}

pub struct ETHRecipientCell {
    pub capacity: u64,
    pub data: ETHRecipientDataView,
    pub index: usize,
}

impl ETHRecipientCell {
    fn build_output_cell(
        &self,
        context: &mut Context,
        outpoints: &OutpointsContext,
    ) -> (Bytes, CellOutput) {
        let output_cell = CellOutput::new_builder()
            .capacity(self.capacity.pack())
            .type_(Some(self.build_typescript(context, outpoints)).pack())
            .lock(self.build_lockscript(context, outpoints))
            .build();
        let output_data = self.data.as_molecule_bytes();
        (output_data, output_cell)
    }

    fn build_typescript(&self, context: &mut Context, outpoints: &OutpointsContext) -> Script {
        context
            .build_script(
                &outpoints[ETH_RECIPIENT_TYPESCRIPT_OUTPOINT_KEY],
                Default::default(),
            )
            .expect("build eth recipient typescript")
    }

    fn build_lockscript(&self, context: &mut Context, outpoints: &OutpointsContext) -> Script {
        context
            .build_script(&outpoints[ALWAYS_SUCCESS_OUTPOINT_KEY], Default::default())
            .expect("build eth recipient lockscript")
    }
}

pub struct ETHRecipientDataView {
    pub eth_recipient_address: String,
    pub eth_token_address: String,
    pub eth_lock_contract_address: String,
    pub eth_bridge_lock_hash: [u8; 32],
    pub token_amount: u128,
    pub fee: u128,
}

impl ETHRecipientDataView {
    pub fn as_molecule_bytes(&self) -> Bytes {
        let data = ETHRecipientCellData::new_builder()
            .eth_recipient_address(str_to_eth_address(self.eth_recipient_address.as_str()))
            .eth_token_address(str_to_eth_address(self.eth_token_address.as_str()))
            .eth_lock_contract_address(str_to_eth_address(self.eth_lock_contract_address.as_str()))
            .eth_bridge_lock_hash(self.eth_bridge_lock_hash.to_vec().try_into().unwrap())
            .token_amount(self.token_amount.into())
            .fee(self.fee.into())
            .build();
        data.as_bytes()
    }
}

pub struct ETHBridgeCell {
    pub capacity: u64,
    pub index: usize,
    pub eth_contract_address: String,
    pub eth_token_address: String,
    pub light_client_typescript_hash: [u8; 32],
}

impl ETHBridgeCell {
    fn build_input_cell(
        &self,
        context: &mut Context,
        outpoints: &OutpointsContext,
    ) -> (OutPoint, CellInput) {
        let (cell_data, cell) = self.build_output_cell(context, outpoints);

        let outpoint = hex::decode(ETH_BRIDGE_INPUT_OUTPOINT).unwrap();
        let outpoint = OutPoint::from_slice(outpoint.as_slice()).unwrap();
        context.create_cell_with_out_point(outpoint.clone(), cell, cell_data);
        let input_cell = CellInput::new_builder()
            .previous_output(outpoint.clone())
            .build();
        (outpoint, input_cell)
    }

    fn build_output_cell(
        &self,
        context: &mut Context,
        outpoints: &OutpointsContext,
    ) -> (Bytes, CellOutput) {
        let output_cell = CellOutput::new_builder()
            .capacity(self.capacity.pack())
            .type_(Some(self.build_typescript(context, outpoints)).pack())
            .lock(self.build_lockscript(context, outpoints))
            .build();
        (Default::default(), output_cell)
    }

    fn build_typescript(&self, context: &mut Context, outpoints: &OutpointsContext) -> Script {
        context
            .build_script(&outpoints[ALWAYS_SUCCESS_OUTPOINT_KEY], Default::default())
            .expect("build eth bridge typescript")
    }

    fn build_lockscript(&self, context: &mut Context, outpoints: &OutpointsContext) -> Script {
        let eth_contract_address = str_to_eth_address(&self.eth_contract_address);
        let eth_token_address = str_to_eth_address(&self.eth_token_address);
        let args = ETHBridgeLockArgs::new_builder()
            .eth_contract_address(eth_contract_address)
            .eth_token_address(eth_token_address)
            .light_client_typescript_hash(
                basic::Byte32::from_slice(&self.light_client_typescript_hash).unwrap(),
            )
            .build()
            .as_bytes();
        context
            .build_script(&outpoints[ETH_BRIDGE_LOCKSCRIPT_OUTPOINT_KEY], args)
            .expect("build eth bridge lockscript")
    }
}

pub struct ScriptView {
    pub outpoint_key: &'static str,
    pub args: Bytes,
}

impl Default for ScriptView {
    fn default() -> Self {
        Self {
            outpoint_key: ALWAYS_SUCCESS_OUTPOINT_KEY,
            args: Default::default(),
        }
    }
}

impl ScriptView {
    pub fn build_script(&self, context: &mut Context, outpoints: &OutpointsContext) -> Script {
        context
            .build_script(&outpoints[self.outpoint_key], self.args.clone())
            .expect("build script succ")
    }

    pub fn build_sudt_owner(
        eth_contract_address: &str,
        eth_token_address: &str,
        light_client_typescript_hash: &[u8; 32],
    ) -> Self {
        let eth_contract_address = str_to_eth_address(eth_contract_address);
        let eth_token_address = str_to_eth_address(eth_token_address);
        let args = ETHBridgeLockArgs::new_builder()
            .eth_contract_address(eth_contract_address)
            .eth_token_address(eth_token_address)
            .light_client_typescript_hash(
                basic::Byte32::from_slice(light_client_typescript_hash).unwrap(),
            )
            .build()
            .as_bytes();
        Self {
            outpoint_key: ETH_BRIDGE_LOCKSCRIPT_OUTPOINT_KEY,
            args,
        }
    }
}

#[derive(Default)]
pub struct SudtCells {
    pub inputs: Vec<SudtCell>,
    pub outputs: Vec<SudtCell>,
}

#[derive(Default)]
pub struct SudtCell {
    pub capacity: u64,
    pub amount: u128,
    pub lockscript: Script,
    pub owner_script: ScriptView,
    pub index: usize,
    pub sudt_extra_data: String,
}

impl SudtCell {
    pub fn build_typescript(&self, context: &mut Context, outpoints: &OutpointsContext) -> Script {
        let owner_script = context
            .build_script(
                &outpoints[self.owner_script.outpoint_key],
                self.owner_script.args.clone(),
            )
            .expect("build owner script");
        let args: [u8; 32] = owner_script.calc_script_hash().unpack();
        let args: Bytes = args.to_vec().into();
        context
            .build_script(&outpoints[SUDT_TYPESCRIPT_OUTPOINT_KEY], args)
            .expect("build sudt typescript fail")
    }
}

impl CellBuilder for SudtCell {
    fn build_input_cell(
        &self,
        context: &mut Context,
        outpoints: &OutpointsContext,
    ) -> (OutPoint, CellInput) {
        let (cell_data, cell) = self.build_output_cell(context, outpoints);
        let input_out_point = context.create_cell(cell, cell_data);
        let input_cell = CellInput::new_builder()
            .previous_output(input_out_point.clone())
            .build();
        (input_out_point, input_cell)
    }

    fn build_output_cell(
        &self,
        context: &mut Context,
        outpoints: &OutpointsContext,
    ) -> (Bytes, CellOutput) {
        let output_cell = CellOutput::new_builder()
            .capacity(self.capacity.pack())
            .type_(Some(self.build_typescript(context, outpoints)).pack())
            .lock(self.lockscript.clone())
            .build();

        let mut output_data = self.amount.to_le_bytes().to_vec();
        output_data.extend(self.sudt_extra_data.as_bytes().to_vec());
        (output_data.into(), output_cell)
    }

    fn get_index(&self) -> usize {
        self.index
    }
}

#[derive(Default)]
pub struct CapacityCells {
    pub inputs: Vec<CapacityCell>,
    pub outputs: Vec<CapacityCell>,
}

#[derive(Default)]
pub struct CapacityCell {
    pub capacity: u64,
    pub lockscript: ScriptView,
    pub index: usize,
}

impl CellBuilder for CapacityCell {
    fn build_input_cell(
        &self,
        context: &mut Context,
        outpoints: &OutpointsContext,
    ) -> (OutPoint, CellInput) {
        let (cell_data, cell) = self.build_output_cell(context, outpoints);
        let input_out_point = context.create_cell(cell, cell_data);
        let input_cell = CellInput::new_builder()
            .previous_output(input_out_point.clone())
            .build();
        (input_out_point, input_cell)
    }

    fn build_output_cell(
        &self,
        context: &mut Context,
        outpoints: &OutpointsContext,
    ) -> (Bytes, CellOutput) {
        let output_cell = CellOutput::new_builder()
            .capacity(self.capacity.pack())
            .lock(self.lockscript.build_script(context, outpoints))
            .build();
        (Default::default(), output_cell)
    }

    fn get_index(&self) -> usize {
        self.index
    }
}

#[derive(Clone)]
#[allow(dead_code)]
pub enum Witness {
    ETHBridgeWitness(ETHBridgeLockWitness),
}

impl Witness {
    pub fn as_bytes(&self) -> Bytes {
        match self {
            Witness::ETHBridgeWitness(witness) => witness.as_bytes(),
        }
    }
}

#[derive(Clone)]
pub struct ETHBridgeLockWitness {
    pub spv_proof: String,
    pub block_number: u128,
    pub block_hash: String,
}

type SMT = SparseMerkleTree<Blake2bHasher, H256, DefaultStore<H256>>;

impl ETHBridgeLockWitness {
    fn generate_smt_tree(block_number: u128, block_hash_raw: &str) -> SMT {
        let mut smt_tree = SMT::default();

        for i in 0u8..100 {
            let mut key = [0u8; 32];
            key[0] = i.to_le_bytes()[0];
            let mut value = [i; 32];

            if i == block_number as u8 {
                let mut block_hash = [0u8; 32];
                block_hash.copy_from_slice(hex::decode(block_hash_raw).unwrap().as_slice());
                value = block_hash;
            }

            smt_tree.update(key.into(), value.into()).unwrap();
        }
        smt_tree
    }

    pub fn as_bytes(&self) -> Bytes {
        let correct_spv_proof = hex::decode(self.spv_proof.clone()).unwrap();

        let smt_tree = ETHBridgeLockWitness::generate_smt_tree(self.block_number, &self.block_hash);

        let mut key = [0u8; 32];
        let mut height = [0u8; 16];
        height.copy_from_slice(self.block_number.to_le_bytes().as_ref());

        key[..16].clone_from_slice(&height);

        let block_hash = smt_tree.get(&key.into());
        let merkle_proof = smt_tree.merkle_proof(vec![key.into()]).unwrap();

        let compiled_merkle_proof = merkle_proof
            .compile(vec![(key.into(), block_hash.unwrap())])
            .unwrap();

        let witness = MintTokenWitness::new_builder()
            .mode(Byte::new(0u8))
            .cell_dep_index_list([0u8].to_vec().into())
            .spv_proof(correct_spv_proof.into())
            .merkle_proof(compiled_merkle_proof.0.into())
            .build();
        WitnessArgs::new_builder()
            .lock(Some(witness.as_bytes()).pack())
            .build()
            .as_bytes()
    }
}

fn str_to_eth_address(s: &str) -> basic::ETHAddress {
    let address: ETHAddress = ETHAddress::try_from(hex::decode(s).unwrap()).expect("decode fail");
    address.get_address().into()
}
