import { SUDTType, UserLock } from './nervos';
import { ethers } from 'ethers';

export type NervosNetworkName = 'Nervos';

// number without decimals, e.g. 0x123aaa(Hex), 12547(Decimal)
// do NOT use such values like, 1.225, 0.22
export type AmountWithoutDecimals = string;

// asset info
export type FungibleAssetInfo = {
  decimals: number;
  name: string;
  symbol: string;
  logoURI: string;
};

export interface NetworkBase {
  Network?: string;
  NativeAssetIdent?: unknown;
  // ident of an fungible derived from this network
  // e.g. Eth -> { address: string } / Nervos -> { type: Script }
  FungibleAssetIdent?: unknown;
  UserIdent?: unknown;

  RawTransaction?: unknown;
  SignedTransaction?: unknown;
}

type XChainShadow<NetworkName> = NetworkName extends NervosNetworkName ? unknown : { shadow: SUDTType };

export interface NetworkTypes<T extends NetworkBase = NetworkBase> {
  Network: T['Network'];
  NativeAssetIdent: T['NativeAssetIdent'];
  FungibleAssetIdent: T['FungibleAssetIdent'];
  AssetIdent: this['NativeAssetIdent'] | this['FungibleAssetIdent'];

  UserIdent: T['UserIdent'];

  UserInfo: { network: T['Network']; ident: T['UserIdent'] };
  // prettier-ignore
  FungibleInfo: { network: T['Network']; ident: T['FungibleAssetIdent'] } & FungibleAssetInfo & XChainShadow<T['Network']>;
  NativeInfo: { network: T['Network']; ident: T['NativeAssetIdent'] } & FungibleAssetInfo & XChainShadow<T['Network']>;
  AssetInfo: this['FungibleInfo'] | this['NativeInfo'];

  NativeAssetWithAmount: { network: T['Network']; amount: AmountWithoutDecimals; ident: T['NativeAssetIdent'] };
  FungibleAssetWithAmount: { network: T['Network']; amount: AmountWithoutDecimals; ident: T['FungibleAssetIdent'] };
  AssetWithAmount: this['NativeAssetWithAmount'] | this['FungibleAssetWithAmount'];

  RawTransaction: T['RawTransaction'];
  SignedTransaction: T['SignedTransaction'];
}

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
