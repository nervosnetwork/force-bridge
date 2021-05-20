#![no_std]
#![no_main]
#![feature(lang_items)]
#![feature(alloc_error_handler)]
#![feature(panic_info_message)]

use bridge_lockscript_lib::verify;
use ckb_std::default_alloc;

default_alloc!();
contracts_helper::entry!(verify);
