import { Script, Address, Transaction, Amount } from '@lay2/pw-core';
import { Collector } from './collector';
import { Asset } from '../model/asset';

export interface MintAssetRecord {
  asset: Asset;
  amount: Amount;
  recipient: Script;
}

export class CkbTxGenerator {
  constructor(public collector: Collector) {}

  async deploy(fromLockscript: Script, binaries: Buffer[]): Promise<Transaction> {
    throw new Error('not implemented');
  }

  async createBridgeCell(fromLockscript: Script, bridgeLockscriptArgs: string | Asset): Promise<Transaction> {
    throw new Error('not implemented');
  }

  async mint(fromLockscript: Script, assets: MintAssetRecord[]): Promise<Transaction> {
    throw new Error('not implemented');
  }

  async burn(fromLockscript: Script, sudtToken: string, amount: Amount, bridgeFee?: Amount): Promise<Transaction> {
    throw new Error('not implemented');
  }
}
