import { BigNumber } from 'bignumber.js';
import { ForceBridgeCore } from '../../core';
import { fromHexString, stringToUint8Array, toHexString } from '../../utils';
import { SerializeForceBridgeLockscriptArgs } from '../tx-helper/generated/force_bridge_lockscript';

export enum ChainType {
  BTC,
  ETH,
  EOS,
  TRON,
  POLKADOT,
}

export abstract class Asset {
  public chainType: ChainType;
  public inWhiteList(): boolean {
    switch (this.chainType) {
      case ChainType.ETH: {
        const whiteAssetList = ForceBridgeCore.config.eth.assetWhiteList;
        if (whiteAssetList.length === 0) return true;
        return undefined !== whiteAssetList.find((asset) => asset.address === this.getAddress());
      }
      case ChainType.BTC:
      case ChainType.EOS:
      case ChainType.TRON:
      case ChainType.POLKADOT:
        return true;
    }
  }
  public getMinimalAmount(): string {
    switch (this.chainType) {
      case ChainType.ETH: {
        const asset = ForceBridgeCore.config.eth.assetWhiteList.find((asset) => asset.address === this.getAddress());
        if (!asset) throw new Error('minimal amount not configed');
        return asset.minimalBridgeAmount;
      }
      case ChainType.BTC:
      case ChainType.EOS:
      case ChainType.TRON:
      case ChainType.POLKADOT:
        return '0';
    }
  }
  public getBridgeFee(direction: 'in' | 'out'): string {
    switch (this.chainType) {
      case ChainType.ETH: {
        const whiteAssetList = ForceBridgeCore.config.eth.assetWhiteList;
        const currentAsset = whiteAssetList.find((asset) => asset.address === this.getAddress());
        if (!currentAsset) throw new Error('asset not in white list');
        if (direction === 'in') return currentAsset.bridgeFee.in;
        return currentAsset.bridgeFee.out;
      }
      case ChainType.BTC:
      case ChainType.EOS:
      case ChainType.TRON:
      case ChainType.POLKADOT:
        return '0';
    }
  }
  public getHumanizedDescription(amount: string): string {
    switch (this.chainType) {
      case ChainType.ETH: {
        const asset = ForceBridgeCore.config.eth.assetWhiteList.find((asset) => asset.address === this.getAddress());
        if (!asset) throw new Error('asset not in white list');
        const humanizedAmount = new BigNumber(amount).times(10 ** -asset.decimal).toString();
        return `${humanizedAmount} ${asset.symbol}`;
      }
      case ChainType.BTC:
      case ChainType.EOS:
      case ChainType.TRON:
      case ChainType.POLKADOT:
        throw new Error('unimplement');
    }
  }
  public parseAmount(amount: string): string {
    switch (this.chainType) {
      case ChainType.ETH: {
        const asset = ForceBridgeCore.config.eth.assetWhiteList.find((asset) => asset.address === this.getAddress());
        if (!asset) throw new Error('asset not in white list');
        return new BigNumber(amount).times(10 ** asset.decimal).toString();
      }
      case ChainType.BTC:
      case ChainType.EOS:
      case ChainType.TRON:
      case ChainType.POLKADOT:
        throw new Error('unimplement');
    }
  }
  public abstract toBridgeLockscriptArgs(): string;
  public abstract getAddress(): string;
}

export class EthAsset extends Asset {
  // '0x00000000000000000000' represents ETH
  // other address represents ERC20 address
  constructor(public address: string, public ownerCellTypeHash: string = '') {
    super();
    if (!address.startsWith('0x') || address.length !== 42) {
      throw new Error('invalid ETH asset address');
    }
    this.chainType = ChainType.ETH;
  }

  toBridgeLockscriptArgs(): string {
    const params = {
      owner_cell_type_hash: fromHexString(this.ownerCellTypeHash).buffer,
      chain: this.chainType,
      asset: fromHexString(toHexString(stringToUint8Array(this.address))).buffer,
    };
    return `0x${toHexString(new Uint8Array(SerializeForceBridgeLockscriptArgs(params)))}`;
  }

  getAddress(): string {
    return this.address;
  }
}

export class TronAsset extends Asset {
  constructor(public address: string, public ownerCellTypeHash: string = '') {
    super();
    this.chainType = ChainType.TRON;
  }

  toBridgeLockscriptArgs(): string {
    const params = {
      owner_cell_type_hash: fromHexString(this.ownerCellTypeHash).buffer,
      chain: this.chainType,
      asset: fromHexString(toHexString(stringToUint8Array(this.address))).buffer,
    };
    return `0x${toHexString(new Uint8Array(SerializeForceBridgeLockscriptArgs(params)))}`;
  }

  getAddress(): string {
    return this.address;
  }
}

export class EosAsset extends Asset {
  constructor(public address: string, public ownerCellTypeHash: string = '') {
    super();
    this.chainType = ChainType.EOS;
  }

  toBridgeLockscriptArgs(): string {
    const params = {
      owner_cell_type_hash: fromHexString(this.ownerCellTypeHash).buffer,
      chain: this.chainType,
      asset: fromHexString(toHexString(stringToUint8Array(this.address))).buffer,
    };
    return `0x${toHexString(new Uint8Array(SerializeForceBridgeLockscriptArgs(params)))}`;
  }

  getAddress(): string {
    return this.address;
  }
}

export class BtcAsset extends Asset {
  constructor(public address: string, public ownerCellTypeHash: string = '') {
    super();
    this.chainType = ChainType.BTC;
  }

  toBridgeLockscriptArgs(): string {
    const params = {
      owner_cell_type_hash: fromHexString(this.ownerCellTypeHash).buffer,
      chain: this.chainType,
      asset: fromHexString(toHexString(stringToUint8Array(this.address))).buffer,
    };
    return `0x${toHexString(new Uint8Array(SerializeForceBridgeLockscriptArgs(params)))}`;
  }

  getAddress(): string {
    return this.address;
  }
}
