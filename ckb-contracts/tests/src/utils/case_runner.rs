#![allow(clippy::all)]

use super::case_builder::{
    CellBuilder, OutpointsContext, TestCase, ALWAYS_SUCCESS_OUTPOINT_KEY,
    BRIDGE_LOCKSCRIPT_OUTPOINT_KEY, FIRST_INPUT_OUTPOINT_KEY, RECIPIENT_TYPESCRIPT_OUTPOINT_KEY,
    SUDT_TYPESCRIPT_OUTPOINT_KEY,
};
use crate::*;
use ckb_testtool::{builtin::ALWAYS_SUCCESS, context::Context};
use ckb_tool::ckb_types::{
    core::TransactionBuilder,
    packed::{CellDep, CellInput, CellOutput},
    prelude::*,
};
use std::mem::replace;

pub const MAX_CYCLES: u64 = 100_000_000_000;

pub fn run_test(case: TestCase) {
    let mut context = Context::default();
    // set capture_debug = true to compare panic info.
    context.set_capture_debug(true);
    let mut outpoints_context = OutpointsContext::new();

    deploy_scripts(&mut context, &mut outpoints_context);

    // Cell deps
    let mut cell_deps = vec![];
    // Custom cell deps
    for cell_dep_view in case.cell_deps.iter() {
        cell_deps.push(cell_dep_view.build_cell_dep(&mut context, &mut outpoints_context));
    }
    // Script cell deps
    for (_, v) in outpoints_context.iter() {
        let cell_dep = CellDep::new_builder().out_point(v.clone()).build();
        cell_deps.push(cell_dep);
    }

    // Cells
    let inputs_len = case.script_cells.inputs.len()
        + case.sudt_cells.inputs.len()
        + case.capacity_cells.inputs.len();
    let outputs_len = case.script_cells.outputs.len()
        + case.sudt_cells.outputs.len()
        + case.capacity_cells.outputs.len();
    let mut inputs = vec![CellInput::default(); inputs_len];
    let mut outputs = vec![CellOutput::default(); outputs_len];
    let mut outputs_data = vec![Bytes::default(); outputs_len];

    build_input_cell(
        case.capacity_cells.inputs.into_iter(),
        &mut context,
        &mut outpoints_context,
        &mut inputs,
    );
    build_input_cell(
        case.script_cells.inputs.into_iter(),
        &mut context,
        &mut outpoints_context,
        &mut inputs,
    );
    build_input_cell(
        case.sudt_cells.inputs.into_iter(),
        &mut context,
        &mut outpoints_context,
        &mut inputs,
    );

    build_output_cell(
        case.script_cells.outputs.into_iter(),
        &mut context,
        &mut outpoints_context,
        &mut outputs,
        &mut outputs_data,
    );
    build_output_cell(
        case.sudt_cells.outputs.into_iter(),
        &mut context,
        &mut outpoints_context,
        &mut outputs,
        &mut outputs_data,
    );
    build_output_cell(
        case.capacity_cells.outputs.into_iter(),
        &mut context,
        &mut outpoints_context,
        &mut outputs,
        &mut outputs_data,
    );

    // Witnesses
    let mut witnesses = vec![];
    for witness in case.witnesses {
        witnesses.push(witness.as_bytes().pack());
    }

    // Build tx
    let tx = TransactionBuilder::default()
        .cell_deps(cell_deps)
        .inputs(inputs)
        .outputs(outputs)
        .outputs_data(outputs_data.pack())
        .witnesses(witnesses)
        .build();
    let tx = context.complete_tx(tx);

    // Test tx
    let res = context.verify_tx(&tx, MAX_CYCLES);
    dbg!(&res);
    dbg!(context.captured_messages());

    match res {
        Ok(cycles) => {
            dbg!("cycles used {}", cycles);
            assert_eq!(case.expect_return_error_info, String::default())
        }
        Err(_err) => {
            assert_ne!(case.expect_return_error_info, String::default());
            assert!(check_err(&context, case.expect_return_error_info));
        }
    }
}

fn deploy_scripts(context: &mut Context, outpoints_context: &mut OutpointsContext) {
    let bridge_lockscript_bin: Bytes = Loader::default().load_binary("bridge-lockscript");
    let bridge_lockscript_point = context.deploy_cell(bridge_lockscript_bin);

    let recipient_typescript_bin: Bytes = Loader::default().load_binary("recipient-typescript");
    let recipient_typescript_point = context.deploy_cell(recipient_typescript_bin);

    let sudt_typescript_bin = include_bytes!("../../deps/simple_udt");
    let sudt_typescript_out_point = context.deploy_cell(Bytes::from(sudt_typescript_bin.as_ref()));

    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    outpoints_context.insert(
        BRIDGE_LOCKSCRIPT_OUTPOINT_KEY,
        bridge_lockscript_point.clone(),
    );
    outpoints_context.insert(
        RECIPIENT_TYPESCRIPT_OUTPOINT_KEY,
        recipient_typescript_point.clone(),
    );
    outpoints_context.insert(
        SUDT_TYPESCRIPT_OUTPOINT_KEY,
        sudt_typescript_out_point.clone(),
    );
    outpoints_context.insert(
        ALWAYS_SUCCESS_OUTPOINT_KEY,
        always_success_out_point.clone(),
    );
}

fn build_input_cell<I, B>(
    iterator: I,
    context: &mut Context,
    outpoints_context: &mut OutpointsContext,
    inputs: &mut Vec<CellInput>,
) where
    I: Iterator<Item = B>,
    B: CellBuilder,
{
    for input in iterator {
        let index = input.get_index();
        let (input_outpoint, input_cell) = input.build_input_cell(context, outpoints_context);
        let _old_value = replace(&mut inputs[index], input_cell);
        if 0 == index {
            outpoints_context.insert(FIRST_INPUT_OUTPOINT_KEY, input_outpoint);
        }
    }
}

fn build_output_cell<I, B>(
    iterator: I,
    context: &mut Context,
    outpoints_context: &mut OutpointsContext,
    outputs: &mut Vec<CellOutput>,
    outputs_data: &mut Vec<Bytes>,
) where
    I: Iterator<Item = B>,
    B: CellBuilder,
{
    for output in iterator {
        let index = output.get_index();
        let (output_data, output_cell) = output.build_output_cell(context, outpoints_context);
        let _old_value = replace(&mut outputs[index], output_cell);
        let _old_value = replace(&mut outputs_data[index], output_data);
    }
}

fn check_err(context: &Context, info: String) -> bool {
    for message in context.captured_messages() {
        if message.message.contains("panic occurred:") && message.message.contains(&info.clone()) {
            return true;
        }
    }
    false
}
