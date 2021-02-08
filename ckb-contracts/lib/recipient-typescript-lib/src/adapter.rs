#[cfg(feature = "std")]
use mockall::predicate::*;
#[cfg(feature = "std")]
use mockall::*;

use ckb_std::ckb_constants::Source;
use ckb_std::ckb_types::packed::Script;
use ckb_std::error::SysError;
use ckb_std::high_level::QueryIter;
use contracts_helper::data_loader::DataLoader;
use force_eth_types::{
    config::{SUDT_CODE_HASH, SUDT_HASH_TYPE, UDT_LEN},
    eth_recipient_cell::ETHRecipientDataView,
};
use std::prelude::v1::*;

#[cfg_attr(feature = "std", automock)]
pub trait Adapter {
    fn load_output_data(&self) -> Option<ETHRecipientDataView>;

    fn get_sudt_amount_from_source(&self, source: Source, lock_hash: &[u8]) -> u128;
}
pub struct ChainAdapter<T: DataLoader> {
    pub chain: T,
}

impl<T> Adapter for ChainAdapter<T>
where
    T: DataLoader,
{
    fn load_output_data(&self) -> Option<ETHRecipientDataView> {
        let data_list = QueryIter::new(
            |index, source| self.chain.load_cell_data(index, source),
            Source::GroupOutput,
        )
        .collect::<Vec<Vec<u8>>>();
        match data_list.len() {
            0 => None,
            1 => Some(
                ETHRecipientDataView::new(data_list[0].as_slice())
                    .expect("ETHRecipientDataView coding error"),
            ),
            _ => panic!("outputs have more than 1 eth recipient cell"),
        }
    }

    fn get_sudt_amount_from_source(&self, source: Source, eth_bridge_lock_hash: &[u8]) -> u128 {
        let mut index = 0;
        let mut sudt_sum = 0;
        loop {
            let cell_type = self.chain.load_cell_type(index, source);
            match cell_type {
                Err(SysError::IndexOutOfBound) => break,
                Err(err) => panic!("iter input return an error: {:?}", err),
                Ok(cell_type) => {
                    if !(is_sudt_typescript(cell_type, eth_bridge_lock_hash)) {
                        index += 1;
                        continue;
                    }

                    let data = self
                        .chain
                        .load_cell_data(index, source)
                        .expect("laod cell data fail");
                    let mut buf = [0u8; UDT_LEN];
                    if data.len() < UDT_LEN {
                        panic!("invalid sudt cell. index: {}, source: {:?}", index, source);
                    }
                    buf.copy_from_slice(&data[0..UDT_LEN]);
                    sudt_sum += u128::from_le_bytes(buf);
                    index += 1;
                }
            }
        }
        sudt_sum
    }
}

fn is_sudt_typescript(script: Option<Script>, lock_hash: &[u8]) -> bool {
    if script.is_none() {
        return false;
    }
    let script = script.unwrap();
    if script.code_hash().raw_data().as_ref() == SUDT_CODE_HASH.as_ref()
        && script.args().raw_data().as_ref() == lock_hash
        && script.hash_type() == SUDT_HASH_TYPE.into()
    {
        return true;
    }
    false
}
