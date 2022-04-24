import { HashType } from '@ckb-lumos/base';
import { NervosNetwork, NetworkBase, NetworkTypes, RequiredAsset } from './network';

export enum BridgeTransactionStatus {
  Pending = 'Pending',
  Successful = 'Successful',
  Failed = 'Failed',
}

/* unix timestamp in milliseconds */
type Timestamp = number;
export type TransactionIdent = { txId: string };
export type TransactionSummary = {
  txSummary: {
    fromAsset: RequiredAsset<'amount'>;
    toAsset: RequiredAsset<'amount'>;
    sender: string;
    recipient: string;
    fromTransaction: TransactionIdent & { timestamp: Timestamp } & { confirmStatus: number | 'confirmed' };
    toTransaction?: TransactionIdent & { timestamp?: Timestamp };
  };
};
export type FailedTransactionSummary = TransactionSummary & { status: BridgeTransactionStatus.Failed; message: string };
export type UnFailedTransactionSummary = TransactionSummary & {
  status: BridgeTransactionStatus.Pending | BridgeTransactionStatus.Successful;
};

export type TransactionSummaryWithStatus = UnFailedTransactionSummary | FailedTransactionSummary;

// XChain -> Nervos
export type GenerateBridgeInTransactionPayload = {
  asset: RequiredAsset<'amount'>;
  recipient: NervosNetwork['UserIdent'];
  // XChain user ident
  sender: string;
};

// Nervos -> XChain
export type GenerateBridgeOutNervosTransactionPayload = {
  // XChain network name
  network: string;
  asset: NervosNetwork['DerivedAssetIdent'];
  amount: string;
  // XChain User ident
  recipient: string;
  sender: NervosNetwork['UserIdent'];
};

export type GenerateTransactionResponse<N extends NetworkTypes> = {
  network: string;
  // TODO
  rawTransaction: N['RawTransaction'];
};

export type SignedTransactionPayload<N extends NetworkBase> = {
  network: N['Network'];
  // TODO
  signedTransaction: N['SignedTransaction'];
};

export type BalancePayload = {
  network: string;
  userIdent: string;
  assetIdent: string;
};

export type GetBalancePayload = Array<BalancePayload>;

export type GetBalanceResponse = Array<RequiredAsset<'amount'>>;

export type GetBridgeTransactionStatusPayload = {
  network: string;
  txId: string;
};

export type BlockChainNetWork = 'Bitcoin' | 'Ethereum' | 'EOS' | 'Tron' | 'Nervos';

export interface GetBridgeTransactionSummariesPayload<N extends BlockChainNetWork> {
  network: N;
  xchainAssetIdent: string;
  user: {
    network: N;
    ident: string;
  };
}

export type GetBridgeTransactionStatusResponse = {
  network: string;
  status: BridgeTransactionStatus;
};

export interface GetMinimalBridgeAmountPayload {
  network: string;
  xchainAssetIdent: string;
  targetChain?: string; // If network == 'Nervos', should provide targetChain
}

export interface GetMinimalBridgeAmountResponse {
  minimalAmount: string;
}

export interface GetBridgeInNervosBridgeFeePayload {
  network: string;
  xchainAssetIdent: string;
  amount: string;
}

export interface GetBridgeInNervosBridgeFeeResponse {
  fee: RequiredAsset<'amount'>;
}

export interface GetBridgeOutNervosBridgeFeePayload {
  network: string;
  xchainAssetIdent: string;
  amount: string;
}

export interface GetBridgeOutNervosBridgeFeeResponse {
  fee: RequiredAsset<'amount'>;
}

export interface GetBridgeNervosToXchainLockBridgeFeePayload {
  xchain: string;
  typescriptHash: string;
  amount: string;
}

export interface GetBridgeNervosToXchainLockBridgeFeeResponse {
  amount: string;
}

export interface GetBridgeNervosToXchainBurnBridgeFeePayload {
  xchain: string;
  typescriptHash: string;
  amount: string;
}

export interface GetBridgeNervosToXchainBurnBridgeFeeResponse {
  xchain: string;
  amount: string;
}

export interface EthereumConfig {
  contractAddress: string;
  confirmNumber: number;
}

export interface GetBridgeConfigResponse {
  nervos: {
    network: 'mainnet' | 'testnet';
    confirmNumber: number;
    omniLockCodeHash: string;
    omniLockHashType: HashType;
  };

  xchains: {
    Ethereum: EthereumConfig;
  };
}

export interface GenerateBridgeNervosToXchainLockTxPayload {
  assetIdent: string; // UDT typescript hash
  amount: string;
  xchain: 'Ethereum'; // only support Ethereum for now
  // Xchain user address
  recipient: string;
  // Nervos address
  sender: string;
}

export interface GenerateBridgeNervosToXchainBurnTxPayload {
  // Xchain asset address
  asset: string;
  amount: string;
  xchain: 'Ethereum'; // only support Ethereum for now
  // Nervos address
  recipient: string;
  // Xchain user address
  sender: string;
}

export interface GetBridgeNervosToXchainTxSummariesPayload {
  xchain: 'Ethereum'; // only support Ethereum for now
  nervosAssetIdent: string; // udt typescript hash
  user: {
    network: 'Nervos' | 'Ethereum';
    // nervos or xchain address
    ident: string;
  };
}

// TODO: change to the higher order generic when it impl
// https://github.com/microsoft/TypeScript/issues/1213
export interface ForceBridgeAPIV1 {
  // prettier-ignore
  generateBridgeInNervosTransaction: <T extends NetworkTypes>(payload: GenerateBridgeInTransactionPayload) => Promise<GenerateTransactionResponse<T>>
  // prettier-ignore
  generateBridgeOutNervosTransaction: <T extends NetworkTypes>(payload: GenerateBridgeOutNervosTransactionPayload) => Promise<GenerateTransactionResponse<T>>

  /* send transaction */
  sendSignedTransaction: <T extends NetworkBase>(payload: SignedTransactionPayload<T>) => Promise<TransactionIdent>;

  /* get transaction summary */
  // prettier-ignore
  /**
   * get the status of a transaction
   */
  getBridgeTransactionStatus: (payload: GetBridgeTransactionStatusPayload) => Promise<GetBridgeTransactionStatusResponse>;

  // prettier-ignore
  getMinimalBridgeAmount: (payload: GetMinimalBridgeAmountPayload) => Promise<GetMinimalBridgeAmountResponse>

  // prettier-ignore
  getBridgeInNervosBridgeFee: (payload: GetBridgeInNervosBridgeFeePayload) => Promise<GetBridgeInNervosBridgeFeeResponse>
  // prettier-ignore
  getBridgeOutNervosBridgeFee: (payload: GetBridgeOutNervosBridgeFeePayload) => Promise<GetBridgeOutNervosBridgeFeeResponse>

  // prettier-ignore
  getBridgeTransactionSummaries: (payload: GetBridgeTransactionSummariesPayload<BlockChainNetWork>) => Promise<TransactionSummaryWithStatus[]>;

  // get an asset list, or if no `name` param is passed in, return a default list of whitelisted assets
  getAssetList: (name?: string) => Promise<RequiredAsset<'info'>[]>;
  // get the user's balance, or if no `assets` param is passed in, return all whitelisted assets
  // prettier-ignore
  getBalance: (payload: GetBalancePayload) => Promise<GetBalanceResponse>;

  getBridgeConfig: () => Promise<GetBridgeConfigResponse>;

  /* Bridge nervos asset to xchain */
  generateBridgeNervosToXchainLockTx: <T extends NetworkTypes>(
    payload: GenerateBridgeNervosToXchainLockTxPayload,
  ) => Promise<GenerateTransactionResponse<T>>;

  generateBridgeNervosToXchainBurnTx: <T extends NetworkTypes>(
    payload: GenerateBridgeNervosToXchainBurnTxPayload,
  ) => Promise<GenerateTransactionResponse<T>>;

  getBridgeNervosToXchainTxSummaries: (
    payload: GetBridgeNervosToXchainTxSummariesPayload,
  ) => Promise<TransactionSummaryWithStatus[]>;
}
