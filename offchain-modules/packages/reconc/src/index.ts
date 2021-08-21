import { BigNumber } from 'bignumber.js';

type ID = string;
// non decimals number formatted string
type Amount = string;

// export interface Identifiable {
//   identity(): string;
// }

// resources on xchain can be mapped to nervos.
// `Universal` is used to represent a certain resource on XChain, which can be an account or an asset
// export interface Universal {
//   network: ID; // xchain network
//
//   identityNervos(): ID;
//
//   identityXChain(): ID; // xchain resource id
// }

export type FromRecord = {
  amount: Amount;
  txId: ID;
};

export type EthLockRecord = FromRecord & {
  sender: string;
  mintId: string;
  token: string;
  recipient: string;
  sudtExtraData: string;
  blockNumber: number;
  blockHash: string;
};

export type CkbBurnRecord = FromRecord & {
  recipient: string;
  token: string;
  chain: number;
  blockNumber?: number;
  blockHash?: string;
};

export type ToRecord = FromRecord & {
  recipient: ID;
  fromTxId?: ID;
  fee?: Amount;
};

export type EthUnlockRecord = ToRecord & {
  token: string;
  blockNumber: number;
  blockHash: string;
};

export type CkbMintRecord = ToRecord & {
  blockNumber?: number;
  blockHash?: string;
};

export class Reconciliation {
  constructor(public from: FromRecord[], public to: ToRecord[]) {}

  checkBalanced(): boolean {
    const { from, to } = this;

    const totalFrom = from.reduce<BigNumber>((sum, record) => sum.plus(record.amount), new BigNumber(0));
    const totalTo = to.reduce<BigNumber>(
      (sum, record) => sum.plus(record.amount).plus(record.fee || 0),
      new BigNumber(0),
    );

    return totalFrom.isEqualTo(totalTo);
  }
}

export interface Reconciler {
  readonly account?: ID;
  readonly asset: ID;

  fetchReconciliation(): Promise<Reconciliation>;
}
