import { Connection, createConnection, getConnectionManager, getConnectionOptions } from 'typeorm';
import { ForceBridgeCore } from '../core';
import { CkbDb, EthDb, KVDb, TronDb } from '../db';
import { BtcDb } from '../db/btc';
import { EosDb } from '../db/eos';
import { BtcHandler } from '../handlers/btc';
import { CkbHandler } from '../handlers/ckb';
import { EosHandler } from '../handlers/eos';
import { EthHandler } from '../handlers/eth';
import { TronHandler } from '../handlers/tron';
import { parsePrivateKey } from '../utils';
import { logger } from '../utils/logger';
import { BTCChain } from '../xchain/btc';
import { EthChain } from '../xchain/eth';

export async function startHandlers(conn: Connection) {
  if (ForceBridgeCore.config.common.role === undefined) {
    ForceBridgeCore.config.common.role = 'watcher';
  }

  logger.info(`startHandlers role:${ForceBridgeCore.config.common.role}`);

  const role = ForceBridgeCore.config.common.role;
  const isCollector = ForceBridgeCore.config.common.role === 'collector';

  // init db and start handlers
  const ckbDb = new CkbDb(conn);
  const kvDb = new KVDb(conn);
  if (isCollector) {
    ForceBridgeCore.config.ckb.fromPrivateKey = parsePrivateKey(ForceBridgeCore.config.ckb.fromPrivateKey);
  }
  const ckbHandler = new CkbHandler(ckbDb, kvDb, role);
  ckbHandler.start();

  // start xchain handlers if config exists
  if (ForceBridgeCore.config.eth !== undefined) {
    if (isCollector) {
      ForceBridgeCore.config.eth.privateKey = parsePrivateKey(ForceBridgeCore.config.eth.privateKey);
    }
    const ethDb = new EthDb(conn);
    const ethChain = new EthChain(role);
    const ethHandler = new EthHandler(ethDb, kvDb, ethChain, role);
    ethHandler.start();
  }
  if (ForceBridgeCore.config.eos !== undefined) {
    if (isCollector) {
      ForceBridgeCore.config.eos.privateKeys = ForceBridgeCore.config.eos.privateKeys.map((pk) => parsePrivateKey(pk));
    }
    const eosDb = new EosDb(conn);
    const eosHandler = new EosHandler(eosDb, ForceBridgeCore.config.eos, role);
    eosHandler.start();
  }
  if (ForceBridgeCore.config.tron !== undefined) {
    if (isCollector) {
      ForceBridgeCore.config.tron.committee.keys = ForceBridgeCore.config.tron.committee.keys.map((pk) =>
        parsePrivateKey(pk),
      );
    }
    const tronDb = new TronDb(conn);
    const tronHandler = new TronHandler(tronDb, role);
    tronHandler.start();
  }
  if (ForceBridgeCore.config.btc !== undefined) {
    if (isCollector) {
      ForceBridgeCore.config.btc.privateKeys = ForceBridgeCore.config.btc.privateKeys.map((pk) => parsePrivateKey(pk));
    }
    const btcDb = new BtcDb(conn);
    const btcChain = new BTCChain();
    const btcHandler = new BtcHandler(btcDb, btcChain, role);
    btcHandler.start();
  }
}
