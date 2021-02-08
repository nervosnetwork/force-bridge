#![no_std]
#![no_main]
#![feature(lang_items)]
#![feature(alloc_error_handler)]
#![feature(panic_info_message)]

use ckb_std::default_alloc;
use recipient_typescript_lib::verify;

default_alloc!();
contracts_helper::entry!(verify);
