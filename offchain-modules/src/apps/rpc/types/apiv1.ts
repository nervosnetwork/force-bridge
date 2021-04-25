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
    fromTransaction: TransactionIdent & { timestamp: Timestamp };
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
  // XChain User ident
  recipient: string;
  sender: NervosNetwork['UserIdent'];
};

export type GenerateTransactionResponse<N extends NetworkTypes> = {
  network: string;
  // TODO
  rawTransaction: N['RawTransaction'];
  bridgeFee: RequiredAsset<'amount'>;
};

export type SignedTransactionPayload<N extends NetworkBase> = {
  network: N['Network'];
  // TODO
  signedTransaction: N['SignedTransaction'];
};

export type GetBalancePayload = Array<{
  network: string;
  userIdent: string;
  assetIdent: string;
}>;

export type GetBalanceResponse = Array<RequiredAsset<'amount'>>;

export type GetBridgeTransactionStatusPayload = {
  network: string;
  txId: string;
};

export type GetBridgeTransactionSummariesPayload = {
  userIdent: string;
  assetIdent: string;
  network: string;
};

export type GetBridgeTransactionStatusResponse = {
  network: string;
  status: BridgeTransactionStatus;
};

// TODO: change to the higher order generic when it impl
// https://github.com/microsoft/TypeScript/issues/1213
export interface ForceBridgeAPIV1 {
  /*
  // prettier-ignore
  generateBridgeInNervosTransaction: (payload: GenerateBridgeInTransactionPayload<EthereumNetwork>) => Promise<GenerateTransactionResponse<EthereumNetwork>>
  // prettier-ignore
  generateBridgeOutNervosTransaction: (payload: GenerateBridgeOutNervosTransactionPayload<EthereumNetwork>) => Promise<GenerateTransactionResponse<NervosNetwork>>


  sendSignedTransaction: (payload: SignedTransactionPayload<EthereumNetwork>) => Promise<TransactionIdent>;

  getBridgeTransactionStatus: (payload: GetBridgeTransactionStatusPayload<AllNetworks>) => Promise<GetBridgeTransactionStatusResponse<AllNetworks>>;
  */
  getBridgeTransactionSummaries: (
    payload: GetBridgeTransactionSummariesPayload,
  ) => Promise<TransactionSummaryWithStatus[]>;

  // get an asset list, or if no `name` param is passed in, return a default list of whitelisted assets
  getAssetList: (name?: string) => Promise<RequiredAsset<'info'>[]>;
  // get the user's balance, or if no `assets` param is passed in, return all whitelisted assets
  // prettier-ignore
  getBalance: (payload: GetBalancePayload) => Promise<GetBalanceResponse>;
}
