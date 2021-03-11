import 'reflect-metadata';
import 'module-alias/register';
import nconf from 'nconf';
import { ForceBridgeCore } from '@force-bridge/core';
import { CkbDb, EthDb } from '@force-bridge/db';
import { CkbHandler } from '@force-bridge/handlers/ckb';
import { EthHandler } from '@force-bridge/handlers/eth';
import { Config } from '@force-bridge/config';
import { createConnection } from 'typeorm';
import { CkbMint, CkbBurn } from '@force-bridge/db/model';
import { EthChain } from '@force-bridge/xchain/eth';

async function main() {
  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const config: Config = nconf.get('forceBridge');
  // init bridge force core
  const core = await new ForceBridgeCore().init(config);

  // init db and start handlers
  const conn = await createConnection();
  const ckbDb = new CkbDb(conn);
  const ckbHandler = new CkbHandler(ckbDb);
  ckbHandler.start();

  // start xchain handlers if config exists
  if (config.eth !== undefined) {
    const ethDb = new EthDb(conn);
    const ethChain = new EthChain();
    const ethHandler = new EthHandler(ethDb, ethChain);
    ethHandler.start();
  }
}

main();
