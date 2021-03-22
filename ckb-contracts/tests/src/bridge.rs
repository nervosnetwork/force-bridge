use crate::utils::{case_builder::*, case_runner};
use ckb_tool::ckb_types::packed::Script;
use ckb_tool::ckb_types::prelude::Unpack;
use force_bridge_types::config::CKB_UNITS;
use molecule::prelude::Entity;

#[test]
fn test_correct_tx() {
    let case = get_correct_case();
    case_runner::run_test(case);
}

#[test]
fn test_tx_when_owner_not_in_inputs() {
    let mut case = get_correct_case();
    #[allow(irrefutable_let_patterns)]
    if let CustomCell::BridgeCustomCell(cell) = &mut case.script_cells.inputs[0] {
        cell.owner_lock_hash = [0u8; 32];
        case.expect_return_error_info = "not authorized to unlock the cell".to_string();
        case_runner::run_test(case);
    };
}

fn get_correct_case() -> TestCase {
    let always_success_lockscript = Script::from_slice(&[
        53u8, 0, 0, 0, 16, 0, 0, 0, 48, 0, 0, 0, 49, 0, 0, 0, 230, 131, 176, 65, 57, 52, 71, 104,
        52, 132, 153, 194, 62, 177, 50, 109, 90, 82, 214, 219, 0, 108, 13, 47, 236, 224, 10, 131,
        31, 54, 96, 215, 0, 0, 0, 0, 0,
    ])
    .unwrap();

    let owner_lock_hash = always_success_lockscript.calc_script_hash().unpack();

    TestCase {
        cell_deps: vec![],
        script_cells: CustomCells {
            inputs: vec![CustomCell::BridgeCustomCell(BridgeCell {
                capacity: 100 * CKB_UNITS,
                index: 0,
                asset: "trx".to_string(),
                chain: 1,
                owner_lock_hash,
            })],
            outputs: vec![CustomCell::BridgeCustomCell(BridgeCell {
                capacity: 100 * CKB_UNITS,
                index: 2,
                asset: "trx".to_string(),
                chain: 1,
                owner_lock_hash,
            })],
        },
        sudt_cells: SudtCells {
            inputs: vec![],
            outputs: vec![
                SudtCell {
                    capacity: 100 * CKB_UNITS,
                    amount: 92,
                    lockscript: always_success_lockscript.clone(),
                    owner_script: ScriptView::build_sudt_owner(
                        1,
                        "trx".to_string(),
                        owner_lock_hash,
                    ),
                    index: 0,
                    sudt_extra_data: "sudt_extra_data".to_string(),
                },
                SudtCell {
                    capacity: 100 * CKB_UNITS,
                    amount: 8,
                    lockscript: always_success_lockscript,
                    owner_script: ScriptView::build_sudt_owner(
                        1,
                        "trx".to_string(),
                        owner_lock_hash,
                    ),
                    index: 1,
                    sudt_extra_data: "sudt_extra_data".to_string(),
                },
            ],
        },
        capacity_cells: CapacityCells {
            inputs: vec![CapacityCell {
                capacity: 200 * CKB_UNITS,
                lockscript: ScriptView::default(),
                index: 1,
            }],
            outputs: vec![],
        },
        witnesses: vec![],
        expect_return_error_info: String::default(),
    }
}
