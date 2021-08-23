#!/usr/bin/env node
import commander from 'commander';
import { feeCmd } from './bridgeFee';
import { changeValCmd } from './changeVal';
import { configCmd } from './config';
import { ethCmd } from './eth';
import { keystoreCmd } from './keystore';
import { monitorCmd } from './monitor';
import { relayerCmd } from './relayer';
import { rpcCmd } from './rpc';
import { sigCmd } from './sigServer';

export const program = commander.program;

const version = '0.0.6';

async function main() {
  program
    .version(version)
    .description('forcecli is command line tool to manage force bridge')
    .addCommand(ethCmd)
    .addCommand(relayerCmd)
    .addCommand(feeCmd)
    .addCommand(rpcCmd)
    .addCommand(sigCmd)
    .addCommand(monitorCmd)
    .addCommand(configCmd)
    .addCommand(changeValCmd)
    .addCommand(keystoreCmd);

  await program.parseAsync(process.argv);
}

void main();
