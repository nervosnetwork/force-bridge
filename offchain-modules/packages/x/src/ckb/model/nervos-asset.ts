import { WhiteListNervosAsset } from '../../config';
import { ForceBridgeCore } from '../../core';
import { ChainType } from './asset';

export class NervosAsset {
  public typescriptHash: string;

  constructor(typescriptHash: string) {
    this.typescriptHash = typescriptHash;
  }

  public getAssetInfo(xchain: ChainType): WhiteListNervosAsset | undefined {
    switch (xchain) {
      case ChainType.ETH: {
        const whiteAssetList = ForceBridgeCore.config.eth.nervosAssetWhiteList;
        return whiteAssetList.find((asset) => asset.typescriptHash === this.typescriptHash);
      }
      case ChainType.BTC:
      case ChainType.EOS:
      case ChainType.TRON:
      case ChainType.POLKADOT:
        throw new Error('only support Ethereum for now');
    }
  }

  public inWhiteList(xchain: ChainType): boolean {
    return undefined !== this.getAssetInfo(xchain);
  }

  public getBridgeFee(direction: 'lock' | 'burn', xchain: ChainType): string {
    switch (xchain) {
      case ChainType.ETH: {
        if (direction === 'lock') return ForceBridgeCore.config.eth.lockNervosAssetFee;
        return ForceBridgeCore.config.eth.burnNervosAssetFee;
      }
      case ChainType.BTC:
      case ChainType.EOS:
      case ChainType.TRON:
      case ChainType.POLKADOT:
        throw new Error('only support Ethereum for now');
    }
  }
}
