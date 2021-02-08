use ckb_std::ckb_constants::Source;
use ckb_std::ckb_types::packed::{CellOutput, OutPoint, Script, WitnessArgs};
use ckb_std::error::SysError;
#[cfg(feature = "std")]
use mockall::predicate::*;
#[cfg(feature = "std")]
use mockall::*;
use std::prelude::v1::*;

#[cfg_attr(feature = "std", automock)]
pub trait DataLoader {
    fn load_script_hash(&self) -> Result<[u8; 32], SysError>;

    fn load_witness_args(&self, index: usize, source: Source) -> Result<WitnessArgs, SysError>;

    fn load_cell_data(&self, index: usize, source: Source) -> Result<Vec<u8>, SysError>;

    fn load_cell_lock_hash(&self, index: usize, source: Source) -> Result<[u8; 32], SysError>;

    fn load_input_out_point(&self, index: usize, source: Source) -> Result<OutPoint, SysError>;

    fn load_cell(&self, index: usize, source: Source) -> Result<CellOutput, SysError>;

    fn load_cell_type(&self, index: usize, source: Source) -> Result<Option<Script>, SysError>;

    fn load_cell_lock(&self, index: usize, source: Source) -> Result<Script, SysError>;

    fn load_cell_type_hash(
        &self,
        index: usize,
        source: Source,
    ) -> Result<Option<[u8; 32]>, SysError>;

    fn load_script(&self) -> Result<Script, SysError>;
}
