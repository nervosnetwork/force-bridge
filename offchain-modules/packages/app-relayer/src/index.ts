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
import { parsePrivateKey } from '@force-bridge/x/dist/utils';
import { initLog } from '@force-bridge/x/dist/utils/logger';
import { BTCChain } from '@force-bridge/x/dist/xchain/btc';
import { EthChain } from '@force-bridge/x/dist/xchain/eth';
import nconf from 'nconf';
import { createConnection } from 'typeorm';

const defaultLogFile = './log/force-bridge-relay.log';

async function main() {
  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const config: Config = nconf.get('forceBridge');
  config.ckb.privateKey = parsePrivateKey(config.ckb.privateKey);
  if (!config.common.log.logFile) {
    config.common.log.logFile = defaultLogFile;
  }

  // init log
  initLog(config.common.log);
  // init bridge force core
  await new ForceBridgeCore().init(config);

  // init db and start handlers
  const conn = await createConnection();
  const ckbDb = new CkbDb(conn);
  const ckbHandler = new CkbHandler(ckbDb);
  ckbHandler.start();

  if (config.eos !== undefined) {
    config.eos.privateKeys = config.eos.privateKeys.map((pk) => parsePrivateKey(pk));
    const eosDb = new EosDb(conn);
    const eosHandler = new EosHandler(eosDb, ForceBridgeCore.config.eos);
    eosHandler.start();
  }

  // start xchain handlers if config exists
  if (config.eth !== undefined) {
    config.eth.privateKey = parsePrivateKey(config.eth.privateKey);
    config.eth.multiSignKeys = config.eth.multiSignKeys.map((pk) => parsePrivateKey(pk));
    const ethDb = new EthDb(conn);
    const ethChain = new EthChain();
    const ethHandler = new EthHandler(ethDb, ethChain);
    ethHandler.start();
  }
  if (config.tron !== undefined) {
    config.tron.committee.keys = config.tron.committee.keys.map((pk) => parsePrivateKey(pk));
    const tronDb = new TronDb(conn);
    const tronHandler = new TronHandler(tronDb);
    tronHandler.start();
  }
  if (config.btc !== undefined) {
    config.btc.privateKeys = config.btc.privateKeys.map((pk) => parsePrivateKey(pk));
    const btcDb = new BtcDb(conn);
    const btcChain = new BTCChain();
    const btcHandler = new BtcHandler(btcDb, btcChain);
    btcHandler.start();
  }
}

main();
