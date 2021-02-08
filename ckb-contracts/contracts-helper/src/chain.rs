use crate::data_loader::DataLoader;
use ckb_std::ckb_constants::Source;
use ckb_std::ckb_types::packed::{CellOutput, OutPoint, Script, WitnessArgs};
use ckb_std::error::SysError;
use ckb_std::high_level::{
    load_cell, load_cell_data, load_cell_lock, load_cell_lock_hash, load_cell_type,
    load_cell_type_hash, load_input_out_point, load_script, load_script_hash, load_witness_args,
};
use std::prelude::v1::*;

pub struct Chain {}

impl DataLoader for Chain {
    fn load_script_hash(&self) -> Result<[u8; 32], SysError> {
        load_script_hash()
    }

    fn load_witness_args(&self, index: usize, source: Source) -> Result<WitnessArgs, SysError> {
        load_witness_args(index, source)
    }

    fn load_cell_data(&self, index: usize, source: Source) -> Result<Vec<u8>, SysError> {
        load_cell_data(index, source)
    }

    fn load_cell_lock_hash(&self, index: usize, source: Source) -> Result<[u8; 32], SysError> {
        load_cell_lock_hash(index, source)
    }

    fn load_input_out_point(&self, index: usize, source: Source) -> Result<OutPoint, SysError> {
        load_input_out_point(index, source)
    }

    fn load_cell(&self, index: usize, source: Source) -> Result<CellOutput, SysError> {
        load_cell(index, source)
    }

    fn load_cell_type(&self, index: usize, source: Source) -> Result<Option<Script>, SysError> {
        load_cell_type(index, source)
    }

    fn load_cell_lock(&self, index: usize, source: Source) -> Result<Script, SysError> {
        load_cell_lock(index, source)
    }

    fn load_cell_type_hash(
        &self,
        index: usize,
        source: Source,
    ) -> Result<Option<[u8; 32]>, SysError> {
        load_cell_type_hash(index, source)
    }

    fn load_script(&self) -> Result<Script, SysError> {
        load_script()
    }
}
