/* primitive */
export type Bytes = string;
export type Encoded = Bytes;
// a string can be used with Number(amount) or BigInt(amount),
// used to represent amount without decimals of an fungible asset
export type Amount = string;

/* identity */
// name of the network, such as Nervos, Ethereum, Tron...
export type Network = string;
// the ident of an type, such as an asset or an user
export type Ident = unknown;

export type IdentWithNetwork<Id extends Ident> = { network: Network } & Id;
export type IdentWithAsset<Id extends Ident> = IdentWithNetwork<Id>;
export type IdentWithTransaction = IdentWithNetwork<{ txId: string }>;

/* asset */
// description of an fungible asset
export type FungibleAssetInfo<Id extends Ident> = {
  ident: IdentWithAsset<Id>;

  name: string;
  symbol: string;
  logoURI: string;
  decimals: number;
};

// type of fungible assets such as SUDT, ERC20, TRC20, etc.
type FungibleAsset<Id extends Ident> = {
  ident: IdentWithAsset<Id>;
  amount: Amount;
};

// shadow asset
export type ShadowFrom<Id extends Ident> = { shadowFrom: IdentWithAsset<Id> };

type Script = { codeHash: string; args: string; hashType: 'type' | 'data' };
type NervosSUDTIdent = { network: 'Nervos'; type: Script };
type NervosSUDT = FungibleAsset<NervosSUDTIdent>;
type NervosShadowSUDT<Id extends Ident> = NervosSUDT & ShadowFrom<Id>;

// type EthereumERC20Ident = { network: 'Ethereum'; address: string };
// type EthereumERC20 = FungibleAsset<EthereumERC20Ident>;

// type TronTRC20Ident = { network: 'Tron'; contract: string };
// type TronTRC20 = FungibleAsset<TronTRC20Ident>;

/* transaction */

enum BridgeTransactionStatus {
  Pending = 'Pending',
  Successful = 'Successful',
  Failed = 'Failed',
}

type TransactionSummary = { fromAsset: FungibleAsset<Ident>; toAsset: FungibleAsset<Ident> };
type FailedTransactionSummary = TransactionSummary & { status: BridgeTransactionStatus.Failed; message: string };
type UnFailedTransactionSummary = TransactionSummary & {
  status: BridgeTransactionStatus.Pending | BridgeTransactionStatus.Successful;
};
type TransactionSummaryWithStatus = UnFailedTransactionSummary | FailedTransactionSummary;

type GenerateBridgeInTransactionPayload = {
  asset: FungibleAsset<Ident>;
  user: Ident;
};

type GenerateBridgeOutNervosTransactionPayload = {
  asset: NervosShadowSUDT<Ident>;
  user: Script;
};

type GenerateTransactionResponse = {
  rawTransaction: Encoded;
  bridgeFee: FungibleAsset<Ident>;
};

type SignedTransactionPayload = IdentWithNetwork<Ident> & { signedTransaction: Encoded };

export interface CommitteeFungibleForceBridgeAPIV1 {
  /* generate transaction */
  // prettier-ignore
  generateBridgeInNervosTransaction: (payload: GenerateBridgeInTransactionPayload) => Promise<GenerateTransactionResponse>;
  // prettier-ignore
  generateBridgeOutNervosTransaction: (payload: GenerateBridgeOutNervosTransactionPayload) => Promise<GenerateTransactionResponse>;

  /* send transaction */
  sendBridgeOutNervosTransaction: (signedTransaction: SignedTransactionPayload) => Promise<IdentWithTransaction>;
  sendBridgeInNervosTransaction: (signedTransaction: SignedTransactionPayload) => Promise<IdentWithTransaction>;

  /* get transaction summary */
  getBridgeTransactionSummary: (txIdent: IdentWithTransaction) => Promise<TransactionSummaryWithStatus>;
  getBridgeTransactionSummaries: (userIdent: Script) => Promise<TransactionSummaryWithStatus[]>;

  // get an asset list, or if no `name` param is passed in, return a default list of whitelisted assets
  getAssetList: (name?: string) => Promise<FungibleAssetInfo<Ident>[]>;
  // get the user's balance, or if no `assets` param is passed in, return all whitelisted assets
  getBalance: (user: IdentWithNetwork<Ident>, assets?: IdentWithAsset<Ident>) => Promise<Amount>;
}
