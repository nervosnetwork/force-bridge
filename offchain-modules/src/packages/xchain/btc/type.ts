export type BtcLockData = {
  txId: string;
  txHash: string;
  sender: string;
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

export type BtcTx = {
  txHash: string;
  startBlockHeight: number;
};

export interface IBlock {
  hash: string;
  confirmations?: number;
  merkleroot?: string;
  height: number;
  tx: ITx[];
  chainwork?: string;
  difficulty?: string;
}

export interface ITx {
  txid: string;
  hash: string;
  vin: IVin[];
  vout: IVout[];
  hex: string;
  blockhash?: string;
}

export interface IVin {
  sequence: number;
  coinbase?: string;
  txid?: string;
  vout?: number;
}

export interface IscriptSig {
  asm: string;
  hex: string;
}

export interface IVout {
  value: string;
  n: string;
  scriptPubKey: IScriptPubKey;
}
export interface IScriptPubKey {
  asm: string;
  hex: string;
  type: string;
  addresses?: string[];
}

export interface IBalance {
  height: number;
  unspents: IUnspents[];
  total_amount: string;
}
export interface IUnspents {
  txid: string;
  vout: number;
  amount: string;
  height: string;
}

export interface MainnetFee {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
}
