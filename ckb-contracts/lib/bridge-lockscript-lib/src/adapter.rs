#[cfg(feature = "std")]
use mockall::predicate::*;
#[cfg(feature = "std")]
use mockall::*;

use ckb_std::ckb_constants::Source;
use ckb_std::error::SysError;
use ckb_std::high_level::QueryIter;
use contracts_helper::data_loader::DataLoader;
use molecule::bytes::Bytes;
use std::prelude::v1::*;

#[cfg_attr(feature = "std", automock)]
pub trait Adapter {
    fn load_script_args(&self) -> Bytes;

    /// check whether there is any input lock script matches the given one
    fn lock_script_exists_in_inputs(&self, hash: &[u8]) -> bool;

    fn get_owner_lock_hash(&self, owner_cell_type_hash: &[u8]) -> [u8; 32];
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

    fn get_owner_lock_hash(&self, owner_cell_type_hash: &[u8]) -> [u8; 32] {
        let mut index = 0;
        let source = Source::CellDep;
        loop {
            let cell_type = self.chain.load_cell_type_hash(index, source);
            match cell_type {
                Err(SysError::IndexOutOfBound) => panic!("owner cell not found"),
                Err(err) => panic!("iter input return an error: {:?}, index: {:?}", err, index),
                Ok(cell_type_hash_opt) => {
                    if let Some(cell_type_hash) = cell_type_hash_opt {
                        if cell_type_hash == owner_cell_type_hash {
                            let data = self
                                .chain
                                .load_cell_lock_hash(index, source)
                                .expect("load cell data fail");
                            return data;
                        }
                    }
                }
            }
            index += 1;
        }
    }
}
