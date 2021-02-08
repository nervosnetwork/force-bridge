use crate::adapter::Adapter;
use ckb_std::ckb_constants::Source;

use blake2b_ref::{Blake2b, Blake2bBuilder};
use ckb_std::ckb_types::packed::{Byte32, Bytes, Script};
use contracts_helper::debug;
use force_eth_types::{
    config::BRIDGE_LOCK_HASH_TYPE,
    eth_recipient_cell::{ETHAddress, ETHRecipientDataView},
    generated::basic,
    generated::eth_bridge_lock_cell::ETHBridgeLockArgs,
};
use molecule::prelude::{Builder, Byte, Entity};
use std::prelude::v1::*;

pub const CKB_HASH_PERSONALIZATION: &[u8] = b"ckb-default-hash";

pub fn verify_burn_token<T: Adapter>(data_loader: T, data: ETHRecipientDataView) {
    let eth_bridge_lock_hash = calc_eth_bridge_lock_hash(
        data.eth_lock_contract_address,
        data.eth_token_address,
        &data.eth_bridge_lock_hash,
        &data.light_client_typescript_hash,
    );
    let input_sudt_num =
        data_loader.get_sudt_amount_from_source(Source::Input, &eth_bridge_lock_hash);
    let output_sudt_num =
        data_loader.get_sudt_amount_from_source(Source::Output, &eth_bridge_lock_hash);
    if input_sudt_num < output_sudt_num {
        panic!(
            "input sudt less than output sudt, input {:?}, output {:?}",
            input_sudt_num, output_sudt_num
        )
    }
    if input_sudt_num - output_sudt_num != data.token_amount {
        panic!(
            "burned token amount not match data amount, input {:?}, output {:?}, data {:?}",
            input_sudt_num, output_sudt_num, data.token_amount
        )
    }

    if data.fee >= data.token_amount {
        panic!(
            "fee is too much, fee {:?}, burned {:?}",
            data.fee, data.token_amount
        )
    }
}

fn calc_eth_bridge_lock_hash(
    eth_contract_address: ETHAddress,
    eth_token_address: ETHAddress,
    eth_bridge_lock_hash: &[u8; 32],
    light_client_typescript_hash: &[u8; 32],
) -> [u8; 32] {
    let args = ETHBridgeLockArgs::new_builder()
        .eth_contract_address(eth_contract_address.get_address().into())
        .eth_token_address(eth_token_address.get_address().into())
        .light_client_typescript_hash(
            basic::Byte32::from_slice(light_client_typescript_hash)
                .expect("convert light_client_typescript_hash to Bytes32"),
        )
        .build();

    let bytes_vec = args.as_slice().iter().map(|b| Byte::new(*b)).collect();

    let eth_bridge_lockscript = Script::new_builder()
        .code_hash(
            Byte32::from_slice(eth_bridge_lock_hash).expect("eth bridge lockscript hash invalid"),
        )
        .hash_type(Byte::new(BRIDGE_LOCK_HASH_TYPE))
        .args(Bytes::new_builder().set(bytes_vec).build())
        .build();

    debug!(
        "bridge lock {:?}, {:?}, {:?}",
        eth_bridge_lockscript.code_hash(),
        eth_bridge_lockscript.hash_type(),
        eth_bridge_lockscript.args().as_slice()
    );
    blake2b_256(eth_bridge_lockscript.as_slice())
}

fn new_blake2b() -> Blake2b {
    Blake2bBuilder::new(32)
        .personal(CKB_HASH_PERSONALIZATION)
        .build()
}

fn blake2b_256(s: &[u8]) -> [u8; 32] {
    let mut result = [0u8; 32];
    let mut blake2b = new_blake2b();
    blake2b.update(s);
    blake2b.finalize(&mut result);
    result
}
