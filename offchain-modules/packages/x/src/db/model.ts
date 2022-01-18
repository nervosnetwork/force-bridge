import { getRepository } from 'typeorm';
import { ChainType } from '../ckb/model/asset';
import { SigType } from '../multisig/multisig-mgr';
import { BtcUnlock } from './entity/BtcUnlock';
import { CkbMint, CkbMintStatus, dbTxStatus } from './entity/CkbMint';
import { EosUnlock } from './entity/EosUnlock';
import { EthLock, TxConfirmStatus } from './entity/EthLock';
import { EthUnlock, EthUnlockStatus } from './entity/EthUnlock';

export { EthUnlock } from './entity/EthUnlock';
export { EthLock, TxConfirmStatus } from './entity/EthLock';
export { BtcLock } from './entity/BtcLock';
export { BtcUnlock } from './entity/BtcUnlock';
export { EosLock } from './entity/EosLock';
export { EosUnlock } from './entity/EosUnlock';
export { CkbMint } from './entity/CkbMint';
export { CkbBurn } from './entity/CkbBurn';
export { TronLock } from './entity/TronLock';
export { TronUnlock } from './entity/TronUnlock';

export interface ISigned {
  sigType: SigType;
  chain: number;
  amount: string;
  asset: string;
  receiver: string;
  refTxHash: string;
  signature: string;
  rawData: string;
  nonce?: number;
  inputOutPoints?: string;
  txHash?: string;
  pubKey: string;
}

export interface IWithdrawedBridgeFee {
  txHash: string;
  blockNumber: number;
  recipient: string;
  chain: number;
  asset: string;
  amount: string;
}

export interface ICkbMint {
  id: string;
  chain: ChainType;
  asset: string;
  amount: string;
  recipientLockscript: string;
  sudtExtraData: string;
  status?: CkbMintStatus;
  blockNumber?: number;
  mintHash?: string;
  message?: string;
}

export interface ICkbUnlock {
  id: string;
  burnTxHash: string;
  xchain: ChainType;
  assetIdent: string;
  amount: string;
  recipientAddress: string;
  udtExtraData: string;
  blockTimestamp: number;
  blockNumber: number;
  unlockTxHash: string;
  extraData: string;
}

export interface IEthMint {
  ckbTxHash: string;
  nervosAssetId: string;
  erc20TokenAddress: string;
  amount: string;
  recipientAddress: string;
  blockNumber: number;
  blockTimestamp: number;
  ethTxHash: string;
}

export interface IEthLock {
  txHash: string;
  sender: string;
  token: string;
  amount: string;
  bridgeFee: string;
  recipient: string;
  sudtExtraData?: string;
  blockNumber: number;
  blockHash: string;
  uniqueId: string;
  confirmNumber?: number;
  confirmStatus?: TxConfirmStatus;
}

export interface IEthBurn {
  uniqueId: string;
  burnTxHash: string;
  sender: string;
  xchainTokenId: string;
  nervosAssetId: string;
  amount: string;
  bridgeFee: string;
  recipient: string;
  udtExtraData?: string;
  blockNumber: number;
  blockTimestamp: number;
  blockHash: string;
  confirmNumber: number;
  confirmStatus: TxConfirmStatus;
}

export interface ICkbBurn {
  senderAddress: string;
  ckbTxHash: string;
  chain: number;
  asset: string;
  amount: string;
  bridgeFee: string;
  recipientAddress: string;
  blockNumber: number;
  confirmNumber: number;
  confirmStatus: TxConfirmStatus;
}

export interface IEthUnlock {
  ckbTxHash: string;
  asset: string;
  amount: string;
  recipientAddress: string;
  blockNumber?: number;
  ethTxHash?: string;
  status?: EthUnlockStatus;
  message?: string;
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

// export async function transformBurnEvent(burn: CkbBurn): Promise<XchainUnlock> {
//   throw new Error('Method not implemented.');
// }

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
  lock_confirm_number: number;
  lock_confirm_status: TxConfirmStatus;
  mint_time: number;
  status: dbTxStatus;
  asset: string;
  message: string;
  bridge_fee: string;
}

export interface UnlockRecord {
  sender: string;
  recipient: string;
  burn_amount: string;
  unlock_amount: string;
  burn_hash: string;
  unlock_hash: string;
  burn_time: number;
  burn_confirm_number: number;
  burn_confirm_status: TxConfirmStatus;
  unlock_time: number;
  status: dbTxStatus;
  asset: string;
  message: string;
  bridge_fee: string;
}

export interface MintedRecord {
  amount: bigint;
  id: string;
  lockTxHash: string;
  lockBlockHeight: number;
}

export interface MintedRecords {
  txHash: string;
  records: MintedRecord[];
}

export interface IQuery {
  getLockRecordsByCkbAddress(ckbRecipientAddr: string, XChainAsset: string): Promise<LockRecord[]>;
  getUnlockRecordsByCkbAddress(ckbAddress: string, XChainAsset: string): Promise<UnlockRecord[]>;
  getLockRecordsByXChainAddress(XChainSender: string, XChainAsset: string): Promise<LockRecord[]>;
  getUnlockRecordsByXChainAddress(XChainRecipientAddr: string, XChainAsset: string): Promise<UnlockRecord[]>;
}
