#!/usr/bin/env node
import commander from 'commander';
import { ethCmd } from './eth';
import { relayerCmd } from './relayer';
import { rpcCmd } from './rpc';
import { sigCmd } from './sigServer';
import { initConfig } from './utils';

export const program = commander.program;

const version = '0.0.1';

async function main() {
  await initConfig();

  program
    .version(version)
    .description('forcecli is command line tool to lock & unlock asset to force bridge')
    .addCommand(ethCmd)
    .addCommand(relayerCmd)
    .addCommand(rpcCmd)
    .addCommand(sigCmd);

  await program.parseAsync(process.argv);
}

main();
