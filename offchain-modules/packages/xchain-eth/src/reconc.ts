import { FromRecord, Reconciler, Reconciliation, ToRecord } from '@force-bridge/reconc';
import { EthAccount, EthFungibleAsset } from './universal';

export class EthLockReconciler implements Reconciler {
  constructor(readonly account: EthAccount, readonly asset: EthFungibleAsset) {}

  async fetchRecords(): Promise<Reconciliation> {
    // TODO fetch and parse events from eth node
    const from: FromRecord[] = [];
    // TODO fetch records from {@link CkbMint}
    const to: ToRecord[] = [];

    return new Reconciliation(from, to);
  }
}

export class EthUnlockReconciler implements Reconciler {
  constructor(readonly account: EthAccount, readonly asset: EthFungibleAsset) {}

  async fetchRecords(): Promise<Reconciliation> {
    // TODO fetch and parse burn transaction on ckb node
    const from: FromRecord[] = [];
    // TODO fetch records from {@link CkbBurn}
    const to: ToRecord[] = [];

    return new Reconciliation(from, to);
  }
}
