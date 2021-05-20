import { Amount } from '@lay2/pw-core';
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
  public inWhiteList(amount: Amount): boolean {
    switch (this.chainType) {
      case ChainType.ETH: {
        const whiteAssetList = ForceBridgeCore.config.eth.assetWhiteList;
        if (whiteAssetList.length === 0) return true;
        const asset = whiteAssetList.find((asset) => asset.address === this.getAddress());
        return !(!asset || amount.lt(new Amount(asset.minimalBridgeAmount, 0)));
      }
      case ChainType.BTC:
      case ChainType.EOS:
      case ChainType.TRON:
      case ChainType.POLKADOT:
        return true;
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
  public abstract toBridgeLockscriptArgs(): string;
  public abstract getAddress(): string;
}

export class EthAsset extends Asset {
  // '0x00000000000000000000' represents ETH
  // other address represents ERC20 address
  constructor(public address: string, public ownLockHash: string = '') {
    super();
    if (!address.startsWith('0x') || address.length !== 42) {
      throw new Error('invalid ETH asset address');
    }
    this.chainType = ChainType.ETH;
  }

  toBridgeLockscriptArgs(): string {
    const params = {
      owner_lock_hash: fromHexString(this.ownLockHash).buffer,
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
  constructor(public address: string, public ownLockHash: string = '') {
    super();
    this.chainType = ChainType.TRON;
  }

  toBridgeLockscriptArgs(): string {
    const params = {
      owner_lock_hash: fromHexString(this.ownLockHash).buffer,
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
  constructor(public address: string, public ownLockHash: string = '') {
    super();
    this.chainType = ChainType.EOS;
  }

  toBridgeLockscriptArgs(): string {
    const params = {
      owner_lock_hash: fromHexString(this.ownLockHash).buffer,
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
  constructor(public address: string, public ownLockHash: string = '') {
    super();
    this.chainType = ChainType.BTC;
  }

  toBridgeLockscriptArgs(): string {
    const params = {
      owner_lock_hash: fromHexString(this.ownLockHash).buffer,
      chain: this.chainType,
      asset: fromHexString(toHexString(stringToUint8Array(this.address))).buffer,
    };
    return `0x${toHexString(new Uint8Array(SerializeForceBridgeLockscriptArgs(params)))}`;
  }

  getAddress(): string {
    return this.address;
  }
}
