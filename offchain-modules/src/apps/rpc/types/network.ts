// network types, all types arr plain JSON object

// types naming conventions:
// XIdent: the ident of the X resource, e.g. type ERC20Ident = { address: '0x...' }
// XInfo: the ident with network e.g. type type ERC20Info = { network: 'Ethereum', address: '0x...' }
import { ethers } from 'ethers';
import { SUDTType, UserLock } from './nervos';

export type NervosNetworkName = 'Nervos';

// number without decimals, e.g. 0x123aaa(Hex), 12547(Decimal)
// do NOT use such values like, 1.225, 0.22
export type AmountWithoutDecimals = string;

export type NetworkBase = {
  Network?: string;
  NativeAssetIdent?: unknown;
  // ident of an fungible derived from this network
  // e.g. Eth -> { address: string } / Nervos -> { type: Script }
  FungibleAssetIdent?: unknown;
  UserIdent?: unknown;

  RawTransaction?: unknown;
  SignedTransaction?: unknown;
};

type FungibleBaseInfo = { decimals: number; name: string; symbol: string; logoURI: string };
type XChainShadow<T extends NetworkBase> = T['Network'] extends NervosNetworkName ? unknown : { shadow: SUDTType };

export type FullFungibleAssetTypes<T extends NetworkBase, IdKey extends keyof NetworkBase> = {
  network: T['Network'];
  ident: T[IdKey];
  amount: AmountWithoutDecimals;
  info: FungibleBaseInfo & XChainShadow<T>;
};

export type ComposeAsset<
  T extends NetworkBase,
  IdKey extends 'NativeAssetIdent' | 'FungibleAssetIdent',
  ObjKey extends keyof FullFungibleAssetTypes<T, IdKey> = 'network' | 'ident'
> = Pick<FullFungibleAssetTypes<T, IdKey>, 'network' | 'ident' | ObjKey>;

export type NativeAsset<T extends NetworkBase> = ComposeAsset<T, 'NativeAssetIdent'>;
export type FungibleAsset<T extends NetworkBase> = ComposeAsset<T, 'FungibleAssetIdent'>;

export type NetworkTypes<T extends NetworkBase = NetworkBase> = Required<T> & {
  AssetIdent: T['FungibleAssetIdent'] | T['NativeAssetIdent'];

  UserInfo: { network: T['Network']; ident: T['UserIdent'] };

  // { network, ident, info }
  FungibleInfo: ComposeAsset<T, 'FungibleAssetIdent', 'info'>;
  // { network, ident, info }
  NativeInfo: ComposeAsset<T, 'NativeAssetIdent', 'info'>;
  // { network, ident, info }
  AssetInfo: ComposeAsset<T, 'FungibleAssetIdent', 'info'> | ComposeAsset<T, 'NativeAssetIdent', 'info'>;

  // { network, ident, amount }
  NativeAssetWithAmount: ComposeAsset<T, 'NativeAssetIdent', 'amount'>;
  // { network, ident, amount }
  FungibleAssetWithAmount: ComposeAsset<T, 'FungibleAssetIdent', 'amount'>;
  // { network, ident, amount }
  AssetWithAmount: ComposeAsset<T, 'NativeAssetIdent', 'amount'> | ComposeAsset<T, 'FungibleAssetIdent', 'amount'>;
};

export type NervosNetwork = NetworkTypes<{
  Network: NervosNetworkName;
  NativeAssetIdent: undefined;
  FungibleAssetIdent: SUDTType;
  UserIdent: UserLock;
  // TODO
  RawTransaction: CKBComponents.RawTransactionToSign;
  // TODO
  SignedTransaction: string;
}>;

export type EthereumNetwork = NetworkTypes<{
  Network: 'Ethereum';
  NativeAssetIdent: { address: '0x0000000000000000000000000000000000000000' };
  FungibleAssetIdent: { address: string };
  UserIdent: { address: string };
  // TODO
  RawTransaction: ethers.PopulatedTransaction;
  // TODO
  SignedTransaction: string;
}>;

export type AllNetworks = NervosNetwork | EthereumNetwork;
export type XChainNetwork = EthereumNetwork;

export type AllAssets =
  | FullFungibleAssetTypes<NervosNetwork, 'NativeAssetIdent'>
  | FullFungibleAssetTypes<NervosNetwork, 'FungibleAssetIdent'>
  | FullFungibleAssetTypes<XChainNetwork, 'NativeAssetIdent'>
  | FullFungibleAssetTypes<XChainNetwork, 'FungibleAssetIdent'>;
