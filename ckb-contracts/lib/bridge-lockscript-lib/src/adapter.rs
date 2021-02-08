#[cfg(feature = "std")]
use mockall::predicate::*;
#[cfg(feature = "std")]
use mockall::*;

use ckb_std::ckb_constants::Source;
use ckb_std::ckb_types::{
    bytes::Bytes,
    packed::{Byte32, Script},
    prelude::Pack,
};
use ckb_std::error::SysError;
use ckb_std::high_level::QueryIter;
use contracts_helper::data_loader::DataLoader;
use force_eth_types::config::{SUDT_CODE_HASH, SUDT_HASH_TYPE};
use molecule::prelude::{Builder, Entity};
use std::prelude::v1::*;

#[cfg_attr(feature = "std", automock)]
pub trait Adapter {
    fn load_input_data(&self) -> Vec<u8>;

    fn load_script_hash(&self) -> [u8; 32];

    fn load_input_witness_args(&self) -> Result<Bytes, SysError>;

    fn load_cell_dep_data(&self, index: usize) -> Result<Vec<u8>, SysError>;

    /// check whether there is any input lock hash matches the given one
    fn lock_hash_exists_in_inputs(&self, hash: &[u8]) -> bool;

    /// check whether there is any output lock script matches the given one
    fn typescript_exists_in_outputs(&self, script: &[u8]) -> bool;

    fn outpoint_exists_in_inputs(&self, outpoint: &[u8]) -> bool;

    /// load cell type, lock, data at the same time.
    fn load_cell_type_lock_data(
        &self,
        index: usize,
        source: Source,
    ) -> Result<(Option<Script>, Script, Vec<u8>), SysError>;

    fn get_associated_udt_script(&self) -> Script {
        let script_hash = self.load_script_hash();
        Script::new_builder()
            .code_hash(Byte32::from_slice(SUDT_CODE_HASH.as_ref()).unwrap())
            .hash_type(SUDT_HASH_TYPE.into())
            .args(Bytes::from(script_hash.to_vec()).pack())
            .build()
    }

    fn load_script_args(&self) -> Result<Bytes, SysError>;

    fn load_dep_cell_typescript_hash(&self, index: usize) -> Result<Option<[u8; 32]>, SysError>;
}

pub struct ChainAdapter<T: DataLoader> {
    pub chain: T,
}

impl<T> Adapter for ChainAdapter<T>
where
    T: DataLoader,
{
    fn load_input_data(&self) -> Vec<u8> {
        let group_data_len = QueryIter::new(
            |index, source| self.chain.load_cell_data(index, source),
            Source::GroupInput,
        )
        .count();
        if group_data_len != 1 {
            panic!("inputs have more than 1 bridge cell");
        }
        self.chain.load_cell_data(0, Source::GroupInput).unwrap()
    }

    fn load_script_hash(&self) -> [u8; 32] {
        self.chain.load_script_hash().unwrap()
    }

    fn load_input_witness_args(&self) -> Result<Bytes, SysError> {
        let witness_args = self
            .chain
            .load_witness_args(0, Source::GroupInput)
            .expect("no witness provided")
            .lock()
            .to_opt()
            .expect("proof witness lock field is none");
        Ok(witness_args.raw_data())
    }

    fn load_cell_dep_data(&self, index: usize) -> Result<Vec<u8>, SysError> {
        self.chain.load_cell_data(index, Source::CellDep)
    }

    fn lock_hash_exists_in_inputs(&self, data: &[u8]) -> bool {
        QueryIter::new(
            |index, source| self.chain.load_cell_lock_hash(index, source),
            Source::Input,
        )
        .any(|hash| hash.as_ref() == data)
    }

    fn typescript_exists_in_outputs(&self, data: &[u8]) -> bool {
        QueryIter::new(
            |index, source| self.chain.load_cell_type(index, source),
            Source::Output,
        )
        .filter_map(|script_opt| script_opt)
        .any(|script| script.as_slice() == data)
    }

    fn outpoint_exists_in_inputs(&self, data: &[u8]) -> bool {
        QueryIter::new(
            |index, source| self.chain.load_input_out_point(index, source),
            Source::Input,
        )
        .any(|outpoint| outpoint.as_slice() == data)
    }

    fn load_cell_type_lock_data(
        &self,
        index: usize,
        source: Source,
    ) -> Result<(Option<Script>, Script, Vec<u8>), SysError> {
        let cell = self.chain.load_cell(index, source)?;
        let data = self.chain.load_cell_data(index, source)?;
        Ok((cell.type_().to_opt(), cell.lock(), data))
    }

    fn load_script_args(&self) -> Result<Bytes, SysError> {
        Ok(self.chain.load_script()?.args().raw_data())
    }

    fn load_dep_cell_typescript_hash(&self, index: usize) -> Result<Option<[u8; 32]>, SysError> {
        self.chain.load_cell_type_hash(index, Source::CellDep)
    }
}
