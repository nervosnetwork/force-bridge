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
import { initLog } from '@force-bridge/utils/logger';
import { parsePrivateKey } from '@force-bridge/utils';

const defaultLogFile = './log/force-bridge-relay.log';

async function main() {
  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const config: Config = nconf.get('forceBridge');
  config.ckb.fromPrivateKey = parsePrivateKey(config.ckb.fromPrivateKey);
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
