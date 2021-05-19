#!/usr/bin/env node
import commander from 'commander';
import { btcCmd } from './btc';
import { eosCmd } from './eos';
import { ethCmd } from './eth';
import { tronCmd } from './tron';
import { initConfig } from './utils';

export const program = commander.program;

const version = '0.0.1';

async function main() {
  await initConfig();

  program
    .version(version)
    .description('forcecli is command line tool to lock & unlock asset to force bridge')
    .addCommand(ethCmd)
    .addCommand(eosCmd)
    .addCommand(tronCmd)
    .addCommand(btcCmd);
  await program.parseAsync(process.argv);
}

main();
