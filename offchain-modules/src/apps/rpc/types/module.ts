import { AmountWithoutDecimals, NetworkTypes } from './network';

type Promisifiable<T> = Promise<T> | T;

export interface Signer<Raw, Signed> {
  sign: (raw: Raw) => Promisifiable<Signed>;
}

export interface ModuleTypes extends NetworkTypes {
  SerializedData?: unknown;
}

export interface AssetModel<M extends ModuleTypes> {
  createFungibleAsset: (amount: AmountWithoutDecimals, asset: M['FungibleAssetIdent']) => M['FungibleAssetWithAmount'];
  createNativeAsset: (amount: AmountWithoutDecimals) => M['NativeAssetWithAmount'];
  // check if two assets are the same asset
  equalsAsset: <X extends { ident: M['FungibleAssetIdent'] }, Y extends { ident: M['FungibleAssetIdent'] }>(
    x: X,
    y: Y,
  ) => boolean;
  // identity of an asset, e.g. address of an ERC20
  identity: <X extends { ident: M['FungibleAssetIdent'] }>(asset: X) => string;
  // check an asset is native asset of the network or not
  isNativeAsset: <X extends { ident: unknown }>(asset: X) => asset is { ident: M['NativeAssetIdent'] } & X;
  // check an asset is derived from an network or not
  isDerivedAsset: <X extends { ident: unknown }>(asset: X) => asset is { ident: M['FungibleAssetIdent'] } & X;
}

export interface Module<M extends ModuleTypes = ModuleTypes> {
  network: M['Network'];
  assetModel: AssetModel<M>;
}
