#![allow(clippy::all)]

use ckb_testtool::context::Context;
pub use ckb_tool::ckb_types::bytes::Bytes;
use ckb_tool::ckb_types::{packed::*, prelude::*};
use core::convert::TryInto;
use force_bridge_types::{
    generated::force_bridge_lockscript::ForceBridgeLockscriptArgs,
    recipient_cell::RecipientDataView,
};
use std::collections::HashMap;
use std::vec::Vec;

pub const BRIDGE_LOCKSCRIPT_OUTPOINT_KEY: &str = "bridge_lockscript_outpoint_key";
pub const RECIPIENT_TYPESCRIPT_OUTPOINT_KEY: &str = "recipient_typescript_outpoint_key";
pub const SUDT_TYPESCRIPT_OUTPOINT_KEY: &str = "sudt_typescript_key";
pub const ALWAYS_SUCCESS_OUTPOINT_KEY: &str = "always_success_outpoint_key";
pub const FIRST_INPUT_OUTPOINT_KEY: &str = "cell_id_outpoint_key";

pub const BRIDGE_INPUT_OUTPOINT: &str =
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
    pub cell_deps: Vec<CellDep>,
    pub owner_cell: Option<OwnerCell>,
    pub script_cells: CustomCells,
    pub sudt_cells: SudtCells,
    pub capacity_cells: CapacityCells,
    pub witnesses: Vec<Witness>,
    pub expect_return_error_info: String,
}

#[derive(Clone)]
pub struct OwnerCell {
    pub lockscript: Script,
    pub typescript: Script,
}

pub struct CustomCells {
    pub inputs: Vec<CustomCell>,
    pub outputs: Vec<CustomCell>,
}

pub enum CustomCell {
    RecipientCustomCell(RecipientCell),
    BridgeCustomCell(BridgeCell),
}

impl CellBuilder for CustomCell {
    fn build_input_cell(
        &self,
        context: &mut Context,
        outpoints: &OutpointsContext,
    ) -> (OutPoint, CellInput) {
        match self {
            CustomCell::BridgeCustomCell(bridge_cell) => {
                bridge_cell.build_input_cell(context, outpoints)
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
            CustomCell::RecipientCustomCell(recipient_cell) => {
                recipient_cell.build_output_cell(context, outpoints)
            }
            CustomCell::BridgeCustomCell(bridge_cell) => {
                bridge_cell.build_output_cell(context, outpoints)
            }
        }
    }

    fn get_index(&self) -> usize {
        match self {
            CustomCell::RecipientCustomCell(recipient_cell) => recipient_cell.index,
            CustomCell::BridgeCustomCell(bridge_cell) => bridge_cell.index,
        }
    }
}

pub struct RecipientCell {
    pub capacity: u64,
    pub data: RecipientDataView,
    pub index: usize,
}

impl RecipientCell {
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
        let output_data = self.data.as_molecule_data().unwrap();
        (output_data, output_cell)
    }

    fn build_typescript(&self, context: &mut Context, outpoints: &OutpointsContext) -> Script {
        context
            .build_script(
                &outpoints[RECIPIENT_TYPESCRIPT_OUTPOINT_KEY],
                Default::default(),
            )
            .expect("build recipient typescript")
    }

    fn build_lockscript(&self, context: &mut Context, outpoints: &OutpointsContext) -> Script {
        context
            .build_script(&outpoints[ALWAYS_SUCCESS_OUTPOINT_KEY], Default::default())
            .expect("build recipient lockscript")
    }
}

pub struct BridgeCell {
    pub capacity: u64,
    pub index: usize,
    pub asset: String,
    pub chain: u8,
    pub owner_cell_type_hash: [u8; 32],
}

impl BridgeCell {
    fn build_input_cell(
        &self,
        context: &mut Context,
        outpoints: &OutpointsContext,
    ) -> (OutPoint, CellInput) {
        let (cell_data, cell) = self.build_output_cell(context, outpoints);

        let outpoint = hex::decode(BRIDGE_INPUT_OUTPOINT).unwrap();
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
            .expect("build bridge typescript")
    }

    fn build_lockscript(&self, context: &mut Context, outpoints: &OutpointsContext) -> Script {
        let force_bridge_lock_args = ForceBridgeLockscriptArgs::new_builder()
            .asset(self.asset.clone().into())
            .chain(self.chain.into())
            .owner_cell_type_hash(
                self.owner_cell_type_hash
                    .to_vec()
                    .try_into()
                    .expect("owner_cell_type_hash convert fail"),
            )
            .build();
        context
            .build_script(
                &outpoints[BRIDGE_LOCKSCRIPT_OUTPOINT_KEY],
                force_bridge_lock_args.as_bytes(),
            )
            .expect("build bridge lockscript")
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

    pub fn build_sudt_owner(chain: u8, asset: String, owner_cell_type_hash: [u8; 32]) -> Self {
        let args = ForceBridgeLockscriptArgs::new_builder()
            .asset(asset.into())
            .chain(chain.into())
            .owner_cell_type_hash(
                owner_cell_type_hash
                    .to_vec()
                    .try_into()
                    .expect("owner_lock_hash convert fail"),
            )
            .build()
            .as_bytes();
        Self {
            outpoint_key: BRIDGE_LOCKSCRIPT_OUTPOINT_KEY,
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
pub enum Witness {}

impl Witness {
    pub fn as_bytes(&self) -> Bytes {
        Bytes::default()
    }
}
