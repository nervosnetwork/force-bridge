use crate::_verify;
use crate::adapter::*;
use ckb_std::ckb_constants::Source;
use ckb_std::ckb_types::prelude::Pack;
use ckb_std::ckb_types::{
    bytes::Bytes,
    packed::{self, Script},
};
use ckb_std::error::SysError;
use contracts_helper::data_loader::MockDataLoader;
use force_bridge_types::config::{SUDT_CODE_HASH, SUDT_HASH_TYPE};
use force_bridge_types::recipient_cell::RecipientDataView;
use molecule::prelude::{Builder, Entity};

struct TestParams {
    input_sudt_amount: u128,
    output_sudt_amount: u128,
    fee: u128,
    amount: u128,
    recipient_address: String,
    chain: u8,
    asset: String,
    owner_lock_hash: [u8; 32],
    bridge_lock_code_hash: [u8; 32],
    bridge_lock_hash_type: u8,
    bridge_lock_hash: [u8; 32],
}

fn get_correct_params() -> TestParams {
    let recipient_address = "mock_address".to_string();
    let chain = 1;
    let asset = "trx".to_string();
    let owner_lock_hash = [100u8; 32];
    let bridge_lock_code_hash = [1u8; 32];
    let bridge_lock_hash_type = 0;
    let bridge_lock_hash = [
        218u8, 23, 180, 100, 78, 151, 151, 22, 206, 10, 203, 43, 214, 141, 196, 63, 115, 243, 138,
        86, 163, 57, 218, 146, 244, 255, 64, 70, 230, 209, 238, 159,
    ];

    TestParams {
        input_sudt_amount: 100,
        output_sudt_amount: 90,
        fee: 1,
        amount: 10,
        recipient_address,
        chain,
        asset,
        owner_lock_hash,
        bridge_lock_code_hash,
        bridge_lock_hash_type,
        bridge_lock_hash,
    }
}

fn generate_correct_mock(test_params: TestParams) -> MockDataLoader {
    let mut mock = MockDataLoader::new();

    let data = RecipientDataView {
        recipient_address: test_params.recipient_address,
        chain: test_params.chain,
        asset: test_params.asset,
        bridge_lock_code_hash: test_params.bridge_lock_code_hash,
        bridge_lock_hash_type: test_params.bridge_lock_hash_type,
        owner_lock_hash: test_params.owner_lock_hash,
        amount: test_params.amount,
        fee: test_params.fee,
    };

    let input_sudt_amount = test_params.input_sudt_amount;
    let output_sudt_amount = test_params.output_sudt_amount;
    mock.expect_load_cell_data()
        .times(4)
        .returning(move |index, source| {
            if source == Source::GroupOutput {
                if index == 0 {
                    Ok(data.as_molecule_data().unwrap().to_vec())
                } else {
                    Err(SysError::IndexOutOfBound)
                }
            } else if source == Source::Input {
                Ok(input_sudt_amount.clone().to_le_bytes().to_vec())
            } else {
                Ok(output_sudt_amount.clone().to_le_bytes().to_vec())
            }
        });

    let correct_bridge_lock_hash = test_params.bridge_lock_hash;
    let correct_sudt_script = Script::new_builder()
        .code_hash(packed::Byte32::from_slice(SUDT_CODE_HASH.as_ref()).unwrap())
        .hash_type(SUDT_HASH_TYPE.into())
        .args(Bytes::from(correct_bridge_lock_hash.to_vec()).pack())
        .build();

    mock.expect_load_cell_type()
        .times(4)
        .returning(move |index, _| {
            if index == 0 {
                Ok(Some(correct_sudt_script.clone()))
            } else {
                Err(SysError::IndexOutOfBound)
            }
        });

    mock
}

#[test]
fn test_burn_token_correct() {
    let test_params = get_correct_params();
    let mock = generate_correct_mock(test_params);

    let adapter = ChainAdapter { chain: mock };

    _verify(adapter);
}

#[test]
#[should_panic(expected = "input sudt less than output sudt")]
fn test_wrong_when_input_less_than_output() {
    let mut test_params = get_correct_params();
    test_params.input_sudt_amount = 90;
    test_params.output_sudt_amount = 100;

    let mock = generate_correct_mock(test_params);

    let adapter = ChainAdapter { chain: mock };

    _verify(adapter);
}

#[test]
#[should_panic(expected = "burned token amount not match data amount")]
fn test_wrong_when_burned_amount_not_equal_data_amount() {
    let mut test_params = get_correct_params();
    test_params.output_sudt_amount = 80;

    let mock = generate_correct_mock(test_params);

    let adapter = ChainAdapter { chain: mock };

    _verify(adapter);
}

#[test]
#[should_panic(expected = "fee is too much")]
fn test_wrong_when_fee_is_too_much() {
    let mut test_params = get_correct_params();
    test_params.fee = 11;

    let mock = generate_correct_mock(test_params);

    let adapter = ChainAdapter { chain: mock };

    _verify(adapter);
}
