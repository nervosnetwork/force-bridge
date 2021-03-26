import 'reflect-metadata';
import 'module-alias/register';
import nconf from 'nconf';
import { ForceBridgeCore } from '@force-bridge/core';
import { CkbDb, EthDb, TronDb } from '@force-bridge/db';
import { CkbHandler } from '@force-bridge/handlers/ckb';
import { EthHandler } from '@force-bridge/handlers/eth';
import { Config } from '@force-bridge/config';
import { createConnection } from 'typeorm';
import { EthChain } from '@force-bridge/xchain/eth';
import { EosHandler } from '@force-bridge/handlers/eos';
import { EosDb } from '@force-bridge/db/eos';
import { TronHandler } from '@force-bridge/handlers/tron';
import { BtcDb } from '@force-bridge/db/btc';
import { BTCChain } from '@force-bridge/xchain/btc';
import { BtcHandler } from '@force-bridge/handlers/btc';

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

  if (config.eos !== undefined) {
    const eosDb = new EosDb(conn);
    const eosHandler = new EosHandler(eosDb, ForceBridgeCore.config.eos);
    eosHandler.start();
  }

  // start xchain handlers if config exists
  if (config.eth !== undefined) {
    const ethDb = new EthDb(conn);
    const ethChain = new EthChain();
    const ethHandler = new EthHandler(ethDb, ethChain);
    ethHandler.start();
  }
  if (config.tron !== undefined) {
    const tronDb = new TronDb(conn);
    const tronHandler = new TronHandler(tronDb);
    tronHandler.start();
  }
  if (config.btc !== undefined) {
    const btcDb = new BtcDb(conn);
    const btcChain = new BTCChain();
    const btcHandler = new BtcHandler(btcDb, btcChain);
    btcHandler.start();
  }
}

main();
