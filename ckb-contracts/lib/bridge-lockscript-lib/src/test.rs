use crate::_verify;
use crate::adapter::*;
use ckb_std::ckb_types::packed::Script;
use ckb_std::ckb_types::prelude::Pack;
use ckb_std::error::SysError;
use contracts_helper::data_loader::MockDataLoader;
use force_bridge_types::generated::force_bridge_lockscript::ForceBridgeLockscriptArgs;
use molecule::prelude::{Builder, Entity};
use std::convert::TryInto;

struct TestParams {
    owner_lock_hash: [u8; 32],
    chain: u8,
    asset: String,
}

fn get_correct_params() -> TestParams {
    TestParams {
        owner_lock_hash: [1u8; 32],
        chain: 1,
        asset: "trx".to_string(),
    }
}

fn generate_correct_mock(test_params: TestParams) -> MockDataLoader {
    let mut mock = MockDataLoader::new();

    let force_bridge_lock_args = ForceBridgeLockscriptArgs::new_builder()
        .asset(test_params.asset.clone().into())
        .chain(test_params.chain.into())
        .owner_lock_hash(
            test_params
                .owner_lock_hash
                .to_vec()
                .try_into()
                .expect("owner_lock_hash convert fail"),
        )
        .build();

    let script = Script::new_builder()
        .args(force_bridge_lock_args.as_bytes().pack())
        .build();

    mock.expect_load_script()
        .times(1)
        .returning(move || Ok(script.clone()));

    let owner_lock_hash = [1u8; 32];
    mock.expect_load_cell_lock_hash()
        .times(1)
        .returning(move |_, _| Ok(owner_lock_hash));

    mock
}

#[test]
fn test_correct_manage_mode() {
    let test_params = get_correct_params();
    let mock = generate_correct_mock(test_params);

    let adapter = ChainAdapter { chain: mock };

    _verify(adapter);
}

#[test]
#[should_panic(expected = "not authorized to unlock the cell")]
fn test_manage_mode_when_lock_script_not_exist_in_inputs() {
    let mut test_params = get_correct_params();
    test_params.owner_lock_hash = [0u8; 32];

    let mut mock = generate_correct_mock(test_params);

    mock.expect_load_cell_lock_hash()
        .times(1)
        .returning(move |_, _| Err(SysError::IndexOutOfBound));

    let adapter = ChainAdapter { chain: mock };

    _verify(adapter);
}
