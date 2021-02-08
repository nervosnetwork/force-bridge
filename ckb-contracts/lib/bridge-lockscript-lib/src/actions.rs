use crate::adapter::Adapter;
use ckb_std::ckb_constants::Source;
use ckb_std::high_level::QueryIter;
use contracts_helper::debug;
use eth_spv_lib::eth_types::*;
use eth_spv_lib::ethspv;
use force_eth_types::config::CONFIRM;
use force_eth_types::eth_lock_event::ETHLockEvent;
use force_eth_types::generated::eth_bridge_lock_cell::ETHBridgeLockArgs;
use force_eth_types::generated::eth_header_cell::ETHHeaderCellMerkleDataReader;
use force_eth_types::generated::witness::{ETHSPVProofReader, MintTokenWitnessReader};
use force_eth_types::hasher::Blake2bHasher;
use molecule::prelude::*;
use std::convert::TryInto;

/// In manage mode, mint associated sudt is forbidden.
/// Owners can do options like destroy the cell or supply capacity for it,
/// which means put an identical cell in output with higher capacity.
pub fn verify_manage_mode<T: Adapter>(data_loader: &T) {
    let udt_script = data_loader.get_associated_udt_script();
    debug!("slice {:?}", udt_script.as_slice());
    if data_loader.typescript_exists_in_outputs(udt_script.as_slice()) {
        panic!("mint sudt is forbidden in owner mode");
    }
}

/// In mint mode, we will verify that we mint correct amount of sudt for correct recipient.
/// 1. Verify the witness is valid and parse the lock event for later usage.
/// 2. Verify the mint logic is valid based on the lock event of ETH and tx data.
pub fn verify_mint_token<T: Adapter>(data_loader: &T, witness: &MintTokenWitnessReader) {
    let (dep_index, eth_receipt_info) = verify_witness(data_loader, witness);
    verify_eth_receipt_info(data_loader, dep_index, eth_receipt_info);
}

/// Verify eth witness data.
/// 1. Verify that the header of the user's cross-chain tx is on the main chain.
/// 2. Verify that the user's cross-chain transaction is legal and really exists (based on spv proof).
/// 3. Get ETHLockEvent from spv proof.
fn verify_witness<T: Adapter>(
    data_loader: &T,
    witness: &MintTokenWitnessReader,
) -> (u8, ETHLockEvent) {
    let proof = witness.spv_proof().raw_data();
    debug!("proof {:?}", proof);
    let cell_dep_index_list = witness.cell_dep_index_list().raw_data();
    assert_eq!(cell_dep_index_list.len(), 1);

    let merkle_proof = witness.merkle_proof().raw_data();
    let lock_event = verify_eth_spv_proof(data_loader, proof, cell_dep_index_list, merkle_proof);
    (cell_dep_index_list[0], lock_event)
}

/// Verify eth witness data.
/// 1. Verify that the header of the user's cross-chain tx is on the main chain.
/// 2. Verify that the user's cross-chain transaction is legal and really exists (based spv proof).
/// @param data is used to get the real lock address.
/// @param proof is the spv proof data for cross-chain tx.
/// @param cell_dep_index_list is used to get headers from light client cell to verify the cross-chain tx really exists on the main chain.
///
fn verify_eth_spv_proof<T: Adapter>(
    data_loader: &T,
    proof: &[u8],
    cell_dep_index_list: &[u8],
    merkle_proof: &[u8],
) -> ETHLockEvent {
    if ETHSPVProofReader::verify(proof, false).is_err() {
        panic!("eth spv proof is invalid")
    }
    let proof_reader = ETHSPVProofReader::new_unchecked(proof);
    let header: BlockHeader =
        rlp::decode(proof_reader.header_data().raw_data()).expect("invalid header data");
    // debug!("the spv proof header data: {:?}", header);

    //verify the header is on main chain.
    verify_eth_header_on_main_chain(data_loader, &header, cell_dep_index_list, merkle_proof);

    get_eth_receipt_info(proof_reader, header)
}

fn verify_eth_header_on_main_chain<T: Adapter>(
    data_loader: &T,
    header: &BlockHeader,
    cell_dep_index_list: &[u8],
    merkle_proof: &[u8],
) {
    debug!("cell_dep_index_list: {:?}", cell_dep_index_list);
    let dep_data = data_loader
        .load_cell_dep_data(cell_dep_index_list[0].into())
        .expect("load cell dep data failed");
    debug!("dep data is {:?}", &dep_data);

    if ETHHeaderCellMerkleDataReader::verify(&dep_data, false).is_err() {
        panic!("eth cell data invalid");
    }

    let eth_cell_data_reader = ETHHeaderCellMerkleDataReader::new_unchecked(&dep_data);
    debug!("eth_cell_data_reader: {:?}", eth_cell_data_reader);

    let mut light_client_latest_height = [0u8; 8];
    light_client_latest_height.copy_from_slice(eth_cell_data_reader.latest_height().raw_data());
    let light_client_latest_height: u64 = u64::from_le_bytes(light_client_latest_height);

    if header.number + CONFIRM as u64 > light_client_latest_height {
        panic!("header is not confirmed on light client yet");
    }

    let mut merkle_root = [0u8; 32];
    merkle_root.copy_from_slice(eth_cell_data_reader.merkle_root().raw_data());

    let compiled_merkle_proof = sparse_merkle_tree::CompiledMerkleProof(merkle_proof.to_vec());

    let mut compiled_leaves = vec![];

    let mut leaf_index = [0u8; 32];
    leaf_index[..8].copy_from_slice(header.number.to_le_bytes().as_ref());

    let mut leaf_value = [0u8; 32];
    leaf_value.copy_from_slice(header.hash.expect("header hash is none").0.as_bytes());

    compiled_leaves.push((leaf_index.into(), leaf_value.into()));

    assert!(compiled_merkle_proof
        .verify::<Blake2bHasher>(&merkle_root.into(), compiled_leaves)
        .expect("verify compiled proof"));
}

fn get_eth_receipt_info(proof_reader: ETHSPVProofReader, header: BlockHeader) -> ETHLockEvent {
    let mut log_index = [0u8; 8];
    log_index.copy_from_slice(proof_reader.log_index().raw_data());
    debug!("log_index is {:?}", &log_index);

    let receipt_data = proof_reader.receipt_data().raw_data().to_vec();
    debug!(
        "receipt_data is {:?}",
        hex::encode(&receipt_data.as_slice())
    );

    let mut receipt_index = [0u8; 8];
    receipt_index.copy_from_slice(proof_reader.receipt_index().raw_data());
    debug!("receipt_index is {:?}", &receipt_index);

    let mut proof = vec![];
    for i in 0..proof_reader.proof().len() {
        proof.push(proof_reader.proof().get_unchecked(i).raw_data().to_vec());
    }
    debug!("proof: {:?}", hex::encode(proof[0].clone()));

    // it will panic inside the function if the proof is invalid
    let receipt = ethspv::verify_log_entry(
        u64::from_le_bytes(receipt_index),
        receipt_data,
        header.receipts_root,
        proof,
    );
    let log_entry = &receipt.logs[u64::from_le_bytes(log_index) as usize];
    let eth_receipt_info = ETHLockEvent::parse_from_event_data(log_entry);
    debug!("log data eth_receipt_info: {:?}", eth_receipt_info);
    eth_receipt_info
}

/// Verify eth receipt info.
/// 1. Verify replay_resist_cell_id exists in inputs.
/// 2. verify contract_address equals to args.contract_address.
/// 3. Verify token_address equals to args.token_address.
/// 4. Verify dep cell typescript hash equals to args.light_client_typescript_hash.
/// 5. Verify ckb_recipient_address get a number of token_amount cToken.
fn verify_eth_receipt_info<T: Adapter>(
    data_loader: &T,
    dep_index: u8,
    eth_receipt_info: ETHLockEvent,
) {
    debug!(
        "replay_resist_outpoint: {:?}",
        hex::encode(eth_receipt_info.replay_resist_outpoint.as_slice())
    );
    if !data_loader.outpoint_exists_in_inputs(eth_receipt_info.replay_resist_outpoint.as_ref()) {
        panic!("replay_resist_cell_id not exists in inputs");
    }

    let script_args = data_loader.load_script_args().unwrap();
    let bridge_args = ETHBridgeLockArgs::new_unchecked(script_args);

    assert_eq!(
        bridge_args.eth_contract_address().as_slice(),
        &eth_receipt_info.contract_address
    );
    assert_eq!(
        bridge_args.eth_token_address().as_slice(),
        &eth_receipt_info.token
    );

    let light_client_typescript_hash = data_loader
        .load_dep_cell_typescript_hash(dep_index as usize)
        .unwrap()
        .unwrap();

    assert_eq!(
        bridge_args.light_client_typescript_hash().as_slice(),
        &light_client_typescript_hash
    );

    let udt_typescript = data_loader.get_associated_udt_script();
    let udt_script_slice = udt_typescript.as_slice();
    let expected_mint_amount: u128 = eth_receipt_info
        .locked_amount
        .try_into()
        .expect("locked amount overflow");
    let bridge_fee: u128 = eth_receipt_info
        .bridge_fee
        .try_into()
        .expect("bridge fee overflow");
    let mut mint_amount = 0u128;
    let mut recipient_amount = 0u128;
    for (output_type, output_lock, output_data) in QueryIter::new(
        |index, source| data_loader.load_cell_type_lock_data(index, source),
        Source::Output,
    )
    .into_iter()
    {
        debug!(
            "udt_script_slice {:?}, output {:?}",
            udt_script_slice,
            output_type.clone().unwrap_or_default().as_slice()
        );
        if output_type.is_some() && udt_script_slice == output_type.unwrap().as_slice() {
            let mut amount = [0u8; 16];
            amount.copy_from_slice(&output_data[..16]);
            let amount = u128::from_le_bytes(amount);
            mint_amount += amount;
            if output_lock.as_slice() == eth_receipt_info.recipient_lockscript.as_slice() {
                if recipient_amount != 0 {
                    panic!("you can only mint one sudt cell for recipient");
                }
                assert_eq!(
                    &output_data[16..],
                    eth_receipt_info.sudt_extra_data.as_slice(),
                    "recipient sudt cell extra data not match"
                );
                recipient_amount += amount;
            }
        }
    }
    assert_eq!(
        mint_amount, expected_mint_amount,
        "mint token amount not equal to expected"
    );
    assert!(
        recipient_amount >= expected_mint_amount - bridge_fee,
        "recipient amount less than expected(mint_amount - bridge_fee)"
    );
}
