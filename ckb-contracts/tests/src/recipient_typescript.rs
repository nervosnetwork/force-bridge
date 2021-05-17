use crate::utils::{case_builder::*, case_runner};
use crate::Loader;
use ckb_tool::ckb_types::packed::CellOutput;
use ckb_tool::ckb_types::packed::Script;
use force_bridge_types::config::CKB_UNITS;
use force_bridge_types::recipient_cell::RecipientDataView;
use molecule::prelude::Entity;

#[test]
fn test_correct_tx() {
    let case = get_correct_case();
    case_runner::run_test(case);
}

#[test]
fn test_tx_when_burned_amount_not_match_data_amount() {
    let mut case = get_correct_case();
    case.sudt_cells.inputs[0].amount = 300;
    case.expect_return_error_info = "burned token amount not match data amount".to_string();
    case_runner::run_test(case);
}

#[test]
fn test_tx_when_fee_bigger_than_burned_amount() {
    let mut case = get_correct_case();
    #[allow(irrefutable_let_patterns)]
    if let CustomCell::RecipientCustomCell(script) = &mut case.script_cells.outputs[0] {
        script.data.fee = 100;
        case.expect_return_error_info = "fee is too much".to_string();
        case_runner::run_test(case);
    };
}

fn get_correct_case() -> TestCase {
    let data = Loader::default().load_binary("bridge-lockscript");
    let data_hash = CellOutput::calc_data_hash(&data);
    let mut lock_hash = [0u8; 32];
    lock_hash.copy_from_slice(data_hash.as_slice());

    let always_success_lockscript = Script::from_slice(&[
        53u8, 0, 0, 0, 16, 0, 0, 0, 48, 0, 0, 0, 49, 0, 0, 0, 230, 131, 176, 65, 57, 52, 71, 104,
        52, 132, 153, 194, 62, 177, 50, 109, 90, 82, 214, 219, 0, 108, 13, 47, 236, 224, 10, 131,
        31, 54, 96, 215, 0, 0, 0, 0, 0,
    ])
    .unwrap();
    TestCase {
        cell_deps: vec![],
        script_cells: CustomCells {
            inputs: vec![],
            outputs: vec![CustomCell::RecipientCustomCell(RecipientCell {
                capacity: 100 * CKB_UNITS,
                data: RecipientDataView {
                    recipient_address: "5Dc158c90EBE46FfC9f03f1174f36c44497976D4".to_string(),
                    chain: 1,
                    asset: "trx".to_string(),
                    bridge_lock_code_hash: lock_hash,
                    bridge_lock_hash_type: 0,
                    owner_lock_hash: [0u8; 32],
                    amount: 100,
                    fee: 10,
                },
                index: 0,
            })],
        },
        sudt_cells: SudtCells {
            inputs: vec![SudtCell {
                capacity: 100 * CKB_UNITS,
                amount: 200,
                lockscript: always_success_lockscript.clone(),
                owner_script: ScriptView::build_sudt_owner(1, "trx".to_string(), [0u8; 32]),
                index: 1,
                sudt_extra_data: Default::default(),
            }],
            outputs: vec![SudtCell {
                capacity: 100 * CKB_UNITS,
                amount: 100,
                lockscript: always_success_lockscript,
                owner_script: ScriptView::build_sudt_owner(1, "trx".to_string(), [0u8; 32]),
                index: 1,
                sudt_extra_data: Default::default(),
            }],
        },
        capacity_cells: CapacityCells {
            inputs: vec![CapacityCell {
                capacity: 200 * CKB_UNITS,
                lockscript: Default::default(),
                index: 0,
            }],
            outputs: vec![],
        },
        witnesses: vec![],
        expect_return_error_info: String::default(),
    }
}
