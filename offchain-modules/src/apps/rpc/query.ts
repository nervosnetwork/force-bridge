import { Asset, ChainType } from '@force-bridge/ckb/model/asset';
import { ForceBridgeCore } from '@force-bridge/core';
import { Amount, Script } from '@lay2/pw-core';
import { IndexerCollector } from '@force-bridge/ckb/tx-helper/collector';
import { IQuery, LockRecord } from '@force-bridge/db/model';
import { BtcDb } from '@force-bridge/db/btc';
import { createConnection } from 'typeorm';
import { EosDb } from '@force-bridge/db/eos';
import { EthDb, TronDb } from '@force-bridge/db';
import { logger } from '@force-bridge/utils/logger';

export async function getBalanceOnCkb(asset: Asset, ckbAddress: string): Promise<Amount> {
  const ckbLockScript = ForceBridgeCore.ckb.utils.addressToScript(ckbAddress);

  const ownLockHash = ForceBridgeCore.ckb.utils.scriptToHash(<CKBComponents.Script>ckbLockScript);
  // const asset = new BtcAsset('btc', ownLockHash);
  const collector = new IndexerCollector(ForceBridgeCore.indexer);
  const bridgeCellLockscript = {
    codeHash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
    hashType: ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
    args: asset.toBridgeLockscriptArgs(),
  };
  const sudtArgs = ckb.utils.scriptToHash(<CKBComponents.Script>bridgeCellLockscript);
  const sudtType = {
    codeHash: ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash,
    hashType: ForceBridgeCore.config.ckb.deps.sudtType.script.hashType,
    args: sudtArgs,
  };
  return await collector.getSUDTBalance(new Script(sudtType.codeHash, sudtType.args, sudtType.hashType), ckbLockScript);
}

export async function getLockRecord(userAddress: string, chainType: ChainType): Promise<LockRecord[]> {
  let dbHandler: IQuery;
  const conn = await createConnection();
  switch (chainType) {
    case ChainType.BTC:
      dbHandler = new BtcDb(conn);
      break;
    case ChainType.EOS:
      dbHandler = new EosDb(conn);
      break;
    case ChainType.ETH:
      dbHandler = new EthDb(conn);
      break;
    case ChainType.TRON:
      dbHandler = new TronDb(conn);
      break;
    default:
      logger.warn(`chain type is ${chainType} which not support yet.`);
      return [];
  }
  return await dbHandler.getLockRecordsByUser(userAddress);
}

export async function getUnlockRecord(userAddress: string, chainType: ChainType): Promise<LockRecord[]> {
  let dbHandler: IQuery;
  const conn = await createConnection();
  switch (chainType) {
    case ChainType.BTC:
      dbHandler = new BtcDb(conn);
      break;
    case ChainType.EOS:
      dbHandler = new EosDb(conn);
      break;
    case ChainType.ETH:
      dbHandler = new EthDb(conn);
      break;
    case ChainType.TRON:
      dbHandler = new TronDb(conn);
      break;
    default:
      logger.warn(`chain type is ${chainType} which not support yet.`);
      return [];
  }
  return await dbHandler.getLockRecordsByUser(userAddress);
}
