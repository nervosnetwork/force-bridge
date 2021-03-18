import { EthUnlock } from '@force-bridge/db/entity/EthUnlock';
import { CkbBurn } from '@force-bridge/db/entity/CkbBurn';
import { CkbMint } from '@force-bridge/db/entity/CkbMint';
import { BtcUnlock } from '@force-bridge/db/entity/BtcUnlock';
import { BtcLock } from '@force-bridge/db/entity/BtcLock';
import { EthLock } from '@force-bridge/db/entity/EthLock';
import { TronLock } from '@force-bridge/db/entity/TronLock';
import { TronUnlock } from '@force-bridge/db/entity/TronUnlock';
import { ChainType } from '@force-bridge/ckb/model/asset';
import { getRepository } from 'typeorm';

export { EthUnlock, EthLock, BtcLock, BtcUnlock, CkbMint, CkbBurn, TronLock, TronUnlock };

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
  recipientLockscript: string;
  sudtExtraData?: string;
  blockNumber: number;
  blockHash: string;
}

export interface IEthUnlock {
  ckbTxHash: string;
  asset: string;
  amount: string;
  recipientAddress: string;
}

export interface ITronLock {
  tronLockTxHash: string;
  tronLockIndex: number;
  tronSender: string;
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

export type XchainUnlock = EthUnlock | BtcUnlock;
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
    recipientLockscript: record.recipientLockscript,
    sudtExtraData: record.sudtExtraData,
  });
}
