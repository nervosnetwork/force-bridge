const TRX_ASSET_LENGTH = 3;
const TRC10_ASSET_LENGTH = 7;

export function getAssetTypeByAsset(asset: string): string {
  switch (asset.length) {
    case TRX_ASSET_LENGTH:
      return 'trx';
    case TRC10_ASSET_LENGTH:
      return 'trc10';
    default:
      return 'trc20';
  }
}
