import 'reflect-metadata';
import { Config } from '@force-bridge/x/dist/config';
import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { CkbDb, EthDb, TronDb } from '@force-bridge/x/dist/db';
import { BtcDb } from '@force-bridge/x/dist/db/btc';
import { EosDb } from '@force-bridge/x/dist/db/eos';
import { BtcHandler } from '@force-bridge/x/dist/handlers/btc';
import { CkbHandler } from '@force-bridge/x/dist/handlers/ckb';
import { EosHandler } from '@force-bridge/x/dist/handlers/eos';
import { EthHandler } from '@force-bridge/x/dist/handlers/eth';
import { TronHandler } from '@force-bridge/x/dist/handlers/tron';
import { BTCChain } from '@force-bridge/x/dist/xchain/btc';
import { EthChain } from '@force-bridge/x/dist/xchain/eth';
import nconf from 'nconf';
import { createConnection } from 'typeorm';

async function main() {
  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const config: Config = nconf.get('forceBridge');
  // init bridge force core
  await new ForceBridgeCore().init(config);

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
