import { AmountWithoutDecimals, ComposeAsset, FungibleAsset, NativeAsset, NetworkTypes } from './network';

type Promisifiable<T> = Promise<T> | T;

export interface Signer<Raw, Signed> {
  sign: (raw: Raw) => Promisifiable<Signed>;
}

export interface ModuleTypes extends NetworkTypes {
  SerializedData?: unknown;
}

// prettier-ignore
export type AssetLike<T extends NetworkTypes = NetworkTypes> = ComposeAsset<T, 'FungibleAssetIdent' | 'NativeAssetIdent'>;

export interface AssetModel<T extends NetworkTypes> {
  network: T['Network'];
  // prettier-ignore
  createFungibleAsset: (options: { amount?: AmountWithoutDecimals; assetIdent: T['FungibleAssetIdent']; }) => T['FungibleAssetWithAmount'];
  //prettier-ignore
  createNativeAsset: (options: { amount?: AmountWithoutDecimals; assetIdent?: T['NativeAssetIdent']; }) => T['NativeAssetWithAmount'];

  // check if two assets are the same asset
  equalsFungibleAsset: <X extends FungibleAsset<T>, Y extends FungibleAsset<T>>(x: X, y: Y) => boolean;
  // identity of an asset, e.g. address of an ERC20
  identity: <X extends FungibleAsset<T>>(asset: X) => string;
  // check an asset is native asset of the network or not
  isNativeAsset: <X extends AssetLike>(asset: X) => asset is NativeAsset<T> & X;
  // check an asset is derived from an network or not
  isDerivedAsset: <X extends AssetLike>(asset: X) => asset is FungibleAsset<T> & X;
}

export interface Module<M extends ModuleTypes = ModuleTypes> {
  network: M['Network'];
  assetModel: AssetModel<M>;
}
