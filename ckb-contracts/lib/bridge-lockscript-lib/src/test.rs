use crate::_verify;
use crate::adapter::*;
use ckb_std::ckb_types::packed::{self, CellOutput, OutPoint, Script, WitnessArgs};
use ckb_std::ckb_types::prelude::Pack;
use ckb_std::error::SysError;
use contracts_helper::data_loader::MockDataLoader;
use force_eth_types::config::{SUDT_CODE_HASH, SUDT_HASH_TYPE};
use force_eth_types::eth_recipient_cell::ETHAddress;
use force_eth_types::generated::{
    basic, eth_bridge_lock_cell::ETHBridgeLockArgs, eth_header_cell::ETHHeaderCellMerkleData,
    witness::MintTokenWitness,
};
use force_eth_types::hasher::Blake2bHasher;
use molecule::bytes::Bytes;
use molecule::prelude::{Builder, Byte, Entity};
use sparse_merkle_tree::{default_store::DefaultStore, SparseMerkleTree, H256};
use std::convert::TryFrom;

type SMT = SparseMerkleTree<Blake2bHasher, H256, DefaultStore<H256>>;

#[derive(Clone)]
struct MintTestParams {
    block_number: u128,
    latest_number: u128,
    block_hash: String,
    recipient_lockscript: Vec<u8>,
    recipient_amount: u128,
    replay_resist_outpoint: String,
    spv_proof: String,
    eth_locker_address: String,
    eth_token_address: String,
    bridge_lockscript: Script,
}

fn get_correct_params() -> MintTestParams {
    let block_number = 45u128;
    let latest_number = 100u128;
    let block_hash = "9485ad52a452389c67ea2364ae42c7a8772c54da7fa2929a6b2bf5261874298e".to_string();
    let recipient_lockscript = [
        73u8, 0, 0, 0, 16, 0, 0, 0, 48, 0, 0, 0, 49, 0, 0, 0, 155, 215, 224, 111, 62, 207, 75, 224,
        242, 252, 210, 24, 139, 35, 241, 185, 252, 200, 142, 93, 75, 101, 168, 99, 123, 23, 114,
        59, 189, 163, 204, 232, 1, 20, 0, 0, 0, 164, 191, 142, 76, 127, 111, 101, 243, 93, 211,
        204, 48, 200, 252, 69, 200, 233, 154, 23, 28,
    ]
    .to_vec();
    let recipient_amount = 100;
    let replay_resist_outpoint =
        "ce2af4461cc6062998febffea311866388e8c869af0cf89ce832dadcd3521f2700000000".to_string();
    let spv_proof = "f70800001800000020000000280000007903000095050000000000000000000000000000000000004d030000f9034a0182ba55b9010000000000000020100000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000020000000000000000000800000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000410000020000000000000000000000000000000002000000000000000000000000000000000f90240f9023d94cd62e77cfe0386343c15c13528675aae9925d7aef863a0413055b58d692937cc2a7d80ca019c17e8d01175e58d11f157ae9124078b01d6a00000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000017c4b5ce0605f63732bfd175fece7ac6b4620fd2b901c00000000000000000000000000000000000000000000000000000000000000064000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000001800000000000000000000000000000000000000000000000000000000000000049490000001000000030000000310000009bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce80114000000a4bf8e4c7f6f65f35dd3cc30c8fc45c8e99a171c00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000024ce2af4461cc6062998febffea311866388e8c869af0cf89ce832dadcd3521f270000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f737564745f65787472615f64617461000000000000000000000000000000000018020000f90215a036d2422d8abce3d513b6a0f20e7488b7279cedda3bd63ad0fc1638557203a621a01dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d493479417c4b5ce0605f63732bfd175fece7ac6b4620fd2a030c80a651cf02f1f53b298be2717084f760591ef0bbb9893840b213bf040de95a0ac6299aea5a7cd8c5a7f26e8c91551582dfd5a49f2e8ec2f4e29abeb7c150d0ca08bd3944f470118f235922d306a8a7f1d92cf4d1924bb30bf7f4f530728f7b72db901000000000000002010000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000002000000000000000000080000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000041000002000000000000000000000000000000000200000000000000000000000000000000083020a492d8657098f88691582ba558460099dcc99d883010917846765746888676f312e31352e33856c696e7578a016733dcbdcbef8e6591fb73c78e160af91811658cd49a589efac8f4b41f9fab08809058be5d324de32620300000800000056030000f90353822080b9034df9034a0182ba55b9010000000000000020100000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000020000000000000000000800000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000410000020000000000000000000000000000000002000000000000000000000000000000000f90240f9023d94cd62e77cfe0386343c15c13528675aae9925d7aef863a0413055b58d692937cc2a7d80ca019c17e8d01175e58d11f157ae9124078b01d6a00000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000017c4b5ce0605f63732bfd175fece7ac6b4620fd2b901c00000000000000000000000000000000000000000000000000000000000000064000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000001800000000000000000000000000000000000000000000000000000000000000049490000001000000030000000310000009bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce80114000000a4bf8e4c7f6f65f35dd3cc30c8fc45c8e99a171c00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000024ce2af4461cc6062998febffea311866388e8c869af0cf89ce832dadcd3521f270000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f737564745f65787472615f646174610000000000000000000000000000000000".to_string();
    let eth_locker_address = "cD62E77cFE0386343c15C13528675aae9925D7Ae".to_string();
    let eth_token_address = "0000000000000000000000000000000000000000".to_string();

    let bridge_lockscript = generate_lock_script(
        eth_locker_address.as_str(),
        eth_token_address.as_str(),
        &[1u8; 32],
    );

    MintTestParams {
        block_number,
        latest_number,
        block_hash,
        recipient_lockscript,
        recipient_amount,
        replay_resist_outpoint,
        spv_proof,
        eth_locker_address,
        eth_token_address,
        bridge_lockscript,
    }
}

fn generate_manage_mode_mock(typescript: Script) -> MockDataLoader {
    let mut mock = MockDataLoader::new();

    let witness = MintTokenWitness::new_builder().mode(Byte::new(1u8)).build();
    let witness_args = WitnessArgs::new_builder()
        .lock(Some(witness.as_bytes()).pack())
        .build();

    mock.expect_load_witness_args()
        .times(1)
        .returning(move |_, _| Ok(witness_args.clone()));

    mock.expect_load_script_hash()
        .times(1)
        .returning(|| Ok([2u8; 32]));

    mock.expect_load_cell_type()
        .times(2)
        .returning(move |index, _| {
            if index == 0 {
                Ok(Some(typescript.clone()))
            } else {
                Err(SysError::IndexOutOfBound)
            }
        });

    mock
}

fn generate_mint_mode_mock(mint_test_params: MintTestParams) -> MockDataLoader {
    let mut mock = MockDataLoader::new();

    let witness_args = generate_mint_token_witness(
        mint_test_params.spv_proof.as_str(),
        mint_test_params.block_number,
        mint_test_params.block_hash.as_str(),
    );
    mock.expect_load_witness_args()
        .times(1)
        .returning(move |_, _| Ok(witness_args.clone()));

    let light_client_data = generate_light_client_data(
        mint_test_params.block_number,
        mint_test_params.latest_number,
        mint_test_params.block_hash.as_str(),
    );
    mock.expect_load_cell_data()
        .times(1)
        .returning(move |_, _| Ok(light_client_data.clone().to_vec()));

    let correct_input_outpoint = mint_test_params.replay_resist_outpoint.as_str();
    let outpoint =
        OutPoint::from_slice(hex::decode(correct_input_outpoint).unwrap().as_slice()).unwrap();
    mock.expect_load_input_out_point()
        .times(1)
        .returning(move |_, _| Ok(outpoint.clone()));

    let lock_script = mint_test_params.bridge_lockscript;
    mock.expect_load_script()
        .times(1)
        .returning(move || Ok(lock_script.clone()));

    mock.expect_load_cell_type_hash()
        .times(1)
        .returning(|_, _| Ok(Some([1u8; 32])));

    mock.expect_load_script_hash()
        .times(1)
        .returning(|| Ok([2u8; 32]));

    let (cell, sudt_data) = generate_sudt_cell(
        mint_test_params.recipient_lockscript.as_slice(),
        mint_test_params.recipient_amount,
    );
    mock.expect_load_cell()
        .times(1)
        .returning(move |_, _| Ok(cell.clone()));

    mock.expect_load_cell_data()
        .times(1)
        .returning(move |_, _| Ok(sudt_data.clone()));

    mock
}

fn generate_smt_tree(block_number: u128, block_hash_raw: &str) -> SMT {
    let mut smt_tree = SMT::default();

    for i in 0u8..100 {
        let mut key = [0u8; 32];
        key[0] = i.to_le_bytes()[0];
        let mut value = [i; 32];

        if i == block_number as u8 {
            let mut block_hash = [0u8; 32];
            block_hash.copy_from_slice(hex::decode(block_hash_raw).unwrap().as_slice());
            value = block_hash;
        }

        smt_tree.update(key.into(), value.into()).unwrap();
    }
    smt_tree
}

fn generate_mint_token_witness(
    spv_proof: &str,
    block_number: u128,
    block_hash: &str,
) -> WitnessArgs {
    let correct_spv_proof = hex::decode(spv_proof).unwrap();

    let smt_tree = generate_smt_tree(block_number, block_hash);

    let mut key = [0u8; 32];
    let mut height = [0u8; 16];
    height.copy_from_slice(block_number.to_le_bytes().as_ref());

    key[..16].clone_from_slice(&height);

    let block_hash = smt_tree.get(&key.into());
    let merkle_proof = smt_tree.merkle_proof(vec![key.into()]).unwrap();

    let compiled_merkle_proof = merkle_proof
        .compile(vec![(key.into(), block_hash.unwrap())])
        .unwrap();

    let witness = MintTokenWitness::new_builder()
        .mode(Byte::new(0u8))
        .cell_dep_index_list([0u8].to_vec().into())
        .spv_proof(correct_spv_proof.into())
        .merkle_proof(compiled_merkle_proof.0.into())
        .build();
    WitnessArgs::new_builder()
        .lock(Some(witness.as_bytes()).pack())
        .build()
}

fn generate_light_client_data(block_number: u128, latest_number: u128, block_hash: &str) -> Bytes {
    let smt_tree = generate_smt_tree(block_number, block_hash);

    let merkle_root = smt_tree.root();

    let data = ETHHeaderCellMerkleData::new_builder()
        .merkle_root(basic::Byte32::from_slice(merkle_root.as_slice()).unwrap())
        .latest_height((latest_number as u64).into())
        .build();

    data.as_bytes()
}

fn generate_lock_script(
    contract_address: &str,
    token_address: &str,
    light_client_typescript_hash: &[u8; 32],
) -> Script {
    let contract_address = ETHAddress::try_from(hex::decode(contract_address).unwrap())
        .unwrap()
        .get_address();
    let token_address = ETHAddress::try_from(hex::decode(token_address).unwrap())
        .unwrap()
        .get_address();

    let lock_args = ETHBridgeLockArgs::new_builder()
        .light_client_typescript_hash(
            basic::Byte32::from_slice(light_client_typescript_hash).unwrap(),
        )
        .eth_contract_address(contract_address.into())
        .eth_token_address(token_address.into())
        .build();
    Script::new_builder()
        .args(lock_args.as_bytes().pack())
        .build()
}

fn generate_sudt_cell(
    recipient_lockscript: &[u8],
    recipient_amount: u128,
) -> (CellOutput, Vec<u8>) {
    let correct_input_lock_hash = [2u8; 32];
    let correct_sudt_script = Script::new_builder()
        .code_hash(packed::Byte32::from_slice(SUDT_CODE_HASH.as_ref()).unwrap())
        .hash_type(SUDT_HASH_TYPE.into())
        .args(Bytes::from(correct_input_lock_hash.to_vec()).pack())
        .build();

    let recipient_lockscript = Script::from_slice(recipient_lockscript).unwrap();

    let cell = CellOutput::new_builder()
        .lock(recipient_lockscript)
        .type_(Some(correct_sudt_script).pack())
        .build();

    let correct_amount: u128 = recipient_amount;
    let correct_sudt_extra = "sudt_extra_data".to_string();
    let mut output_data = correct_amount.to_le_bytes().to_vec();
    output_data.extend(correct_sudt_extra.as_bytes().to_vec());
    (cell, output_data)
}

#[test]
fn test_manage_mode_correct() {
    let mock = generate_manage_mode_mock(Script::default());
    let adapter = crate::adapter::ChainAdapter { chain: mock };

    _verify(adapter);
}

#[test]
#[should_panic(expected = "mint sudt is forbidden in owner mode")]
fn test_manage_mode_wrong_when_output_have_sudt() {
    let typescript = Script::from_slice(
        [
            85u8, 0, 0, 0, 16, 0, 0, 0, 48, 0, 0, 0, 49, 0, 0, 0, 225, 227, 84, 214, 214, 67, 173,
            66, 114, 77, 64, 150, 126, 51, 73, 132, 83, 78, 3, 103, 64, 92, 90, 228, 42, 157, 125,
            99, 215, 125, 244, 25, 0, 32, 0, 0, 0, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
            2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
        ]
        .as_ref(),
    )
    .unwrap();
    let mock = generate_manage_mode_mock(typescript);
    let adapter = crate::adapter::ChainAdapter { chain: mock };

    _verify(adapter);
}

#[test]
fn test_mint_mode_correct() {
    let mint_test_params = get_correct_params();

    let mut mock = generate_mint_mode_mock(mint_test_params);

    mock.expect_load_cell()
        .times(1)
        .returning(|_, _| Err(SysError::IndexOutOfBound));

    let adapter = crate::adapter::ChainAdapter { chain: mock };

    _verify(adapter);
}

#[test]
#[should_panic(expected = "eth spv proof is invalid")]
fn test_mint_mode_invalid_proof() {
    let mut mock = MockAdapter::new();
    let witness = MintTokenWitness::new_builder()
        .cell_dep_index_list([0u8].to_vec().into())
        .build();
    mock.expect_load_input_witness_args()
        .times(1)
        .returning(move || Ok(witness.as_bytes()));
    _verify(mock);
}

#[test]
#[should_panic(expected = "eth cell data invalid")]
fn test_mint_mode_eth_cell_data_invalid() {
    let mint_test_params = get_correct_params();

    let mut mock = MockDataLoader::new();

    let witness_args = generate_mint_token_witness(
        mint_test_params.spv_proof.as_str(),
        mint_test_params.block_number,
        mint_test_params.block_hash.as_str(),
    );
    mock.expect_load_witness_args()
        .times(1)
        .returning(move |_, _| Ok(witness_args.clone()));

    mock.expect_load_cell_data()
        .times(1)
        .returning(move |_, _| Ok(Bytes::new().to_vec()));

    let adapter = crate::adapter::ChainAdapter { chain: mock };

    _verify(adapter);
}

#[test]
#[should_panic(expected = "header is not confirmed on light client yet")]
fn test_mint_mode_header_not_confirm() {
    let mut mint_test_params = get_correct_params();
    mint_test_params.latest_number = 50;

    let mock = generate_mint_mode_mock(mint_test_params);
    let adapter = crate::adapter::ChainAdapter { chain: mock };

    _verify(adapter);
}

#[test]
#[should_panic(expected = "replay_resist_cell_id not exists in inputs")]
fn test_mint_mode_replay_resist_cell_not_exist() {
    let mut mint_test_params = get_correct_params();
    mint_test_params.replay_resist_outpoint =
        "000000000000000000000000000000000000000000000000000000000000000000000000".to_string();

    let mut mock = generate_mint_mode_mock(mint_test_params);
    mock.expect_load_input_out_point()
        .times(1)
        .returning(move |_, _| Err(SysError::IndexOutOfBound));

    let adapter = crate::adapter::ChainAdapter { chain: mock };

    _verify(adapter);
}

#[test]
#[should_panic(expected = "you can only mint one sudt cell for recipient")]
fn test_mint_mode_mint_more_than_one_sudt_for_recipient() {
    let mint_test_params = get_correct_params();

    let mut mock = generate_mint_mode_mock(mint_test_params.clone());

    let (cell, sudt_data) = generate_sudt_cell(mint_test_params.recipient_lockscript.as_slice(), 1);
    mock.expect_load_cell()
        .times(1)
        .returning(move |_, _| Ok(cell.clone()));

    mock.expect_load_cell_data()
        .times(1)
        .returning(move |_, _| Ok(sudt_data.clone()));

    let adapter = crate::adapter::ChainAdapter { chain: mock };

    _verify(adapter);
}

#[test]
#[should_panic(expected = "proof witness lock field is none")]
fn test_mock_chain() {
    let mut mock_chain = MockDataLoader::new();
    mock_chain
        .expect_load_witness_args()
        .returning(|_index, _source| Ok(WitnessArgs::default()));
    let adapter = crate::adapter::ChainAdapter { chain: mock_chain };
    _verify(adapter);
}
