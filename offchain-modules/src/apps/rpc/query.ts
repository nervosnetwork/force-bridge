import { Asset, BtcAsset, ChainType, EosAsset, EthAsset, TronAsset } from '@force-bridge/ckb/model/asset';
import { ForceBridgeCore } from '@force-bridge/core';
import { Script } from '@lay2/pw-core';
import { IndexerCollector } from '@force-bridge/ckb/tx-helper/collector';
import { IQuery, LockRecord, UnlockRecord } from '@force-bridge/db/model';
import { BtcDb } from '@force-bridge/db/btc';
import { Connection, createConnection } from 'typeorm';
import { EosDb } from '@force-bridge/db/eos';
import { EthDb, TronDb } from '@force-bridge/db';
import { logger } from '@force-bridge/utils/logger';
import assert from 'assert';

export async function getBalance(chainType: number, ckbAddress: string, tokenAddress?: string): Promise<string> {
  const ckbLockScript: CKBComponents.Script = ForceBridgeCore.ckb.utils.addressToScript(ckbAddress);
  const ownLockHash = ForceBridgeCore.ckb.utils.scriptToHash(ckbLockScript);
  let asset: Asset;
  switch (chainType) {
    case ChainType.BTC:
      asset = new BtcAsset('btc', ownLockHash);
      break;
    case ChainType.EOS:
      asset = new EosAsset('EOS', ownLockHash);
      break;
    case ChainType.ETH:
      asset = new EthAsset(tokenAddress, ownLockHash);
      break;
    case ChainType.TRON:
      asset = new TronAsset(tokenAddress, ownLockHash);
      break;
    default:
      logger.warn(`chain type is ${chainType} which not support yet.`);
      return;
  }

  const collector = new IndexerCollector(ForceBridgeCore.indexer);
  const bridgeCellLockscript = {
    codeHash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
    hashType: ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
    args: asset.toBridgeLockscriptArgs(),
  };
  const sudtArgs = ForceBridgeCore.ckb.utils.scriptToHash(<CKBComponents.Script>bridgeCellLockscript);
  const sudtType = {
    codeHash: ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash,
    hashType: ForceBridgeCore.config.ckb.deps.sudtType.script.hashType,
    args: sudtArgs,
  };
  const balance = await collector.getSUDTBalance(
    new Script(sudtType.codeHash, sudtType.args, sudtType.hashType),
    Script.fromRPC({
      code_hash: ckbLockScript.codeHash,
      args: ckbLockScript.args,
      hash_type: ckbLockScript.hashType,
    }),
  );
  return balance.toString();
}
export async function getLockRecord(
  conn: Connection,
  userAddress: string,
  chainType: ChainType,
): Promise<LockRecord[]> {
  let dbHandler: IQuery;
  logger.debug(`chainType ${chainType}, userAddress  ${userAddress}`);

  switch (chainType) {
    case ChainType.BTC:
      logger.debug(`btc module`);
      dbHandler = new BtcDb(conn);
      break;
    case ChainType.ETH:
      dbHandler = new EthDb(conn);
      break;
    case ChainType.EOS:
      logger.debug(`eos module`);
      dbHandler = new EosDb(conn);
      break;
    case ChainType.TRON:
      dbHandler = new TronDb(conn);
      break;
    default:
      logger.warn(`chain type is ${chainType} which not support yet.`);
      return [];
  }
  const result = await dbHandler.getLockRecordsByUser(userAddress);
  logger.debug(`getLockRecord ${JSON.stringify(result, null, 2)}`);

  return result;
}

export async function getUnlockRecord(
  conn: Connection,
  ckbAddress: string,
  chainType: ChainType,
): Promise<UnlockRecord[]> {
  logger.debug(`chainType ${chainType}, ckbAddress  ${ckbAddress}`);
  const ckbLockScript = ForceBridgeCore.ckb.utils.addressToScript(ckbAddress);
  const ownLockHash = ForceBridgeCore.ckb.utils.scriptToHash(<CKBComponents.Script>ckbLockScript);
  let dbHandler: IQuery;
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
  return await dbHandler.getUnlockRecordsByUser(ownLockHash);
}
