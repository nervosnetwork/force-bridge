#![cfg_attr(not(feature = "std"), no_std)]

#[cfg(not(feature = "std"))]
extern crate alloc;
extern crate no_std_compat as std;

pub mod adapter;
#[cfg(test)]
mod test;

use adapter::Adapter;
use force_bridge_types::generated::force_bridge_lockscript::ForceBridgeLockscriptArgsReader;
use molecule::prelude::Reader;

#[cfg(target_arch = "riscv64")]
pub fn verify() -> i8 {
    let chain = contracts_helper::chain::Chain {};
    let adapter = adapter::ChainAdapter { chain };
    _verify(adapter);
    0
}

pub fn _verify<T: Adapter>(data_loader: T) {
    let script_args = data_loader.load_script_args();
    ForceBridgeLockscriptArgsReader::verify(&script_args, false).expect("args are invalid");
    let force_bridge_args = ForceBridgeLockscriptArgsReader::new_unchecked(&script_args);

    if !data_loader
        .lock_script_exists_in_inputs(force_bridge_args.owner_lock_hash().raw_data().as_ref())
    {
        panic!("not authorized to unlock the cell");
    }
}
