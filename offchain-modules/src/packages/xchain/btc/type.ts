export type BtcLockData = {
  txId: string;
  txHash: string;
  txIndex: number;
  amount: string;
  data: string;
  rawTx: string;
  blockHeight: number;
  blockHash: string;
};
export type BtcUnlockResult = {
  txHash: string;
  startBlockHeight: number;
};
