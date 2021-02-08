#![cfg_attr(not(feature = "std"), no_std)]

#[cfg(not(feature = "std"))]
extern crate alloc;
extern crate no_std_compat as std;

// pub mod actions;
// pub mod adapter;
// #[cfg(test)]
// mod test;

// use adapter::Adapter;
use molecule::prelude::Reader;

#[cfg(target_arch = "riscv64")]
pub fn verify() -> i8 {
    // let chain = contracts_helper::chain::Chain {};
    // let adapter = adapter::ChainAdapter { chain };
    // _verify(adapter);
    0
}

// pub fn _verify<T: Adapter>(data_loader: T) {
//     // // load and parse witness
//     // let witness_args = data_loader
//     //     .load_input_witness_args()
//     //     .expect("load witness args error");
//     // // debug!("witness args: {:?}", &witness_args);
//     // MintTokenWitnessReader::verify(&witness_args, false).expect("witness is invalid");
//     // let witness = MintTokenWitnessReader::new_unchecked(&witness_args);
//     // // debug!("witness: {:?}", witness);
//     //
//     // // check mode
//     // let mode: u8 = witness.mode().into();
//     // match mode {
//     //     0 => {
//     //         actions::verify_mint_token(&data_loader, &witness);
//     //     }
//     //     _ => {
//     //         actions::verify_manage_mode(&data_loader);
//     //     }
//     // }
// }
