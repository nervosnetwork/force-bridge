#![cfg_attr(not(feature = "std"), no_std)]

#[cfg(not(feature = "std"))]
extern crate alloc;
extern crate no_std_compat as std;

pub mod actions;
pub mod adapter;
#[cfg(test)]
mod test;

pub use adapter::Adapter;

#[cfg(target_arch = "riscv64")]
pub fn verify() -> i8 {
    let chain = contracts_helper::chain::Chain {};
    let adapter = adapter::ChainAdapter { chain };
    _verify(adapter);
    0
}

// recipient-typescript has two situations based on whether outputs have recipient-typescript data:
// 1: if outputs have data, we ensure it's a burn-token tx.
// 2: if outputs don't have data, it's a destroy receipt-cell tx, it will always success.
pub fn _verify<T: Adapter>(data_loader: T) -> i8 {
    let data = data_loader.load_output_data();
    if let Some(data) = data {
        actions::verify_burn_token(data_loader, data)
    }
    0
}
