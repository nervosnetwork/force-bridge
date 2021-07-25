import { Connection } from 'typeorm';
import { ForceBridgeCore } from '../core';
import { BridgeFeeDB, CkbDb, EthDb, KVDb, TronDb } from '../db';
import { BtcDb } from '../db/btc';
import { EosDb } from '../db/eos';
import { BtcHandler } from '../handlers/btc';
import { CkbHandler } from '../handlers/ckb';
import { EosHandler } from '../handlers/eos';
import { EthHandler } from '../handlers/eth';
import { TronHandler } from '../handlers/tron';
import { BridgeMetricSingleton } from '../metric/bridge-metric';
import { logger } from '../utils/logger';
import { BTCChain } from '../xchain/btc';
import { EthChain } from '../xchain/eth';

export function startHandlers(conn: Connection): void {
  if (ForceBridgeCore.config.common.role === undefined) {
    ForceBridgeCore.config.common.role = 'watcher';
  }

  logger.info(`startHandlers role:${ForceBridgeCore.config.common.role}`);

  const role = ForceBridgeCore.config.common.role;

  BridgeMetricSingleton.getInstance(role).init(ForceBridgeCore.config.common.openMetric);

  // init db and start handlers
  const ckbDb = new CkbDb(conn);
  const kvDb = new KVDb(conn);
  const ckbHandler = new CkbHandler(ckbDb, kvDb, role);
  ForceBridgeCore.getXChainHandler().ckb = ckbHandler;
  ckbHandler.start();

  // start xchain handlers if config exists
  if (ForceBridgeCore.config.eth !== undefined) {
    const ethDb = new EthDb(conn);
    const feeDb = new BridgeFeeDB(conn);
    const ethChain = new EthChain(role);
    const ethHandler = new EthHandler(ethDb, feeDb, kvDb, ethChain, role);
    ForceBridgeCore.getXChainHandler().eth = ethHandler;
    ethHandler.start();
  }

  if (ForceBridgeCore.config.eos !== undefined) {
    const eosDb = new EosDb(conn);
    const eosHandler = new EosHandler(eosDb, ForceBridgeCore.config.eos, role);
    eosHandler.start();
  }

  if (ForceBridgeCore.config.tron !== undefined) {
    const tronDb = new TronDb(conn);
    const tronHandler = new TronHandler(tronDb, role);
    tronHandler.start();
  }

  if (ForceBridgeCore.config.btc !== undefined) {
    const btcDb = new BtcDb(conn);
    const btcChain = new BTCChain();
    const btcHandler = new BtcHandler(btcDb, btcChain, role);
    btcHandler.start();
  }
}
