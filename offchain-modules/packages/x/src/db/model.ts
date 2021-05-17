import { getRepository } from 'typeorm';
import { ChainType } from '../ckb/model/asset';
import { BtcLock } from './entity/BtcLock';
import { BtcUnlock } from './entity/BtcUnlock';
import { CkbBurn } from './entity/CkbBurn';
import { CkbMint, dbTxStatus } from './entity/CkbMint';
import { EosLock } from './entity/EosLock';
import { EosUnlock } from './entity/EosUnlock';
import { EthLock } from './entity/EthLock';
import { EthUnlock } from './entity/EthUnlock';
import { TronLock } from './entity/TronLock';
import { TronUnlock } from './entity/TronUnlock';

// export { EthUnlock, EthLock, BtcLock, BtcUnlock, EosLock, EosUnlock, CkbMint, CkbBurn, TronLock, TronUnlock };

export { EthUnlock } from './entity/EthUnlock';
export { EthLock } from './entity/EthLock';
export { BtcLock } from './entity/BtcLock';
export { BtcUnlock } from './entity/BtcUnlock';
export { EosLock } from './entity/EosLock';
export { EosUnlock } from './entity/EosUnlock';
export { CkbMint } from './entity/CkbMint';
export { CkbBurn } from './entity/CkbBurn';
export { TronLock } from './entity/TronLock';
export { TronUnlock } from './entity/TronUnlock';

export interface ICkbMint {
  id: string;
  chain: ChainType;
  asset: string;
  amount: string;
  recipientLockscript: string;
  sudtExtraData?: string;
}

export interface IEthLock {
  txHash: string;
  sender: string;
  token: string;
  amount: string;
  recipient: string;
  sudtExtraData?: string;
  blockNumber: number;
  blockHash: string;
}

export interface ICkbBurn {
  senderLockHash: string;
  ckbTxHash: string;
  chain: number;
  asset: string;
  amount: string;
  recipientAddress: string;
  blockNumber: number;
}

export interface IEthUnlock {
  ckbTxHash: string;
  asset: string;
  amount: string;
  recipientAddress: string;
}

export interface ITronLock {
  txHash: string;
  txIndex: number;
  sender: string;
  asset: string;
  assetType: string;
  amount: string;
  memo: string;
  timestamp: number;
}

export interface ITronUnlock {
  ckbTxHash: string;
  asset: string;
  assetType: string;
  amount: string;
  recipientAddress: string;
}

export type XchainUnlock = EthUnlock | BtcUnlock | EosUnlock;

export async function transformBurnEvent(burn: CkbBurn): Promise<XchainUnlock> {
  throw new Error('Method not implemented.');
}

// export type XchainLock = EthLock | BtcLock;
// export async function transformMintEvent(burn: XchainLock): Promise<CkbMint> {
//     if(burn instanceof EthLock) {
//
//
//     } else if (burn instanceof BtcLock) {
//       throw new Error('Method not implemented');
//     }
//
// }

export function EthLock2CkbMint(record: EthLock): CkbMint {
  const ckbMintRepo = getRepository(CkbMint);
  return ckbMintRepo.create({
    id: record.txHash,
    chain: ChainType.ETH,
    amount: record.amount,
    asset: record.token,
    recipientLockscript: record.recipient,
    sudtExtraData: record.sudtExtraData,
  });
}

export interface IEosLock {
  id: string;
  globalActionSeq: number;
  actionPos: number;
  txHash: string;
  actionIndex: number;
  sender: string;
  token: string;
  amount: string;
  memo: string;
  blockNumber: number;
}

export interface IEosUnlock {
  ckbTxHash: string;
  asset: string;
  amount: string;
  recipientAddress: string;
}

export function EosLock2CkbMint(record: IEosLock): CkbMint {
  const ckbMintRepo = getRepository(CkbMint);
  return ckbMintRepo.create({
    id: record.id,
    chain: ChainType.EOS,
    amount: record.amount,
    asset: record.token,
    recipientLockscript: record.memo,
  });
}

export interface IBtcLock {
  txid: string;
  txHash: string;
  sender: string;
  amount: string;
  rawTx: string;
  data: string;
  blockHeight: number;
  blockHash: string;
  txIndex: number;
}

export interface IBtcUnLock {
  ckbTxHash: string;
  chain: number;
  asset: string;
  amount: string;
  recipientAddress: string;
}

export interface LockRecord {
  sender: string;
  recipient: string;
  lock_amount: string;
  mint_amount: string;
  lock_hash: string;
  mint_hash: string;
  lock_time: number;
  mint_time: number;
  status: dbTxStatus;
  asset: string;
  message: string;
}

export interface UnlockRecord {
  sender: string;
  recipient: string;
  burn_amount: string;
  unlock_amount: string;
  burn_hash: string;
  unlock_hash: string;
  burn_time: number;
  unlock_time: number;
  status: dbTxStatus;
  asset: string;
  message: string;
}

export interface IQuery {
  getLockRecordsByCkbAddress(ckbRecipientAddr: string, XChainAsset: string): Promise<LockRecord[]>;
  getUnlockRecordsByCkbAddress(ckbLockScriptHash: string, XChainAsset: string): Promise<UnlockRecord[]>;
  getLockRecordsByXChainAddress(XChainSender: string, XChainAsset: string): Promise<LockRecord[]>;
  getUnlockRecordsByXChainAddress(XChainRecipientAddr: string, XChainAsset: string): Promise<UnlockRecord[]>;
}
