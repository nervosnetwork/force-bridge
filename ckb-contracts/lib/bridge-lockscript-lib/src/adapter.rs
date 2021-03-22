#[cfg(feature = "std")]
use mockall::predicate::*;
#[cfg(feature = "std")]
use mockall::*;

use ckb_std::ckb_constants::Source;
use ckb_std::high_level::QueryIter;
use contracts_helper::data_loader::DataLoader;
use molecule::bytes::Bytes;
use std::prelude::v1::*;

#[cfg_attr(feature = "std", automock)]
pub trait Adapter {
    fn load_script_args(&self) -> Bytes;

    /// check whether there is any input lock script matches the given one
    fn lock_script_exists_in_inputs(&self, hash: &[u8]) -> bool;
}

pub struct ChainAdapter<T: DataLoader> {
    pub chain: T,
}

impl<T> Adapter for ChainAdapter<T>
where
    T: DataLoader,
{
    fn load_script_args(&self) -> Bytes {
        self.chain.load_script().unwrap().args().raw_data()
    }

    fn lock_script_exists_in_inputs(&self, data: &[u8]) -> bool {
        QueryIter::new(
            |index, source| self.chain.load_cell_lock_hash(index, source),
            Source::Input,
        )
        .any(|script| script.as_ref() == data)
    }
}
