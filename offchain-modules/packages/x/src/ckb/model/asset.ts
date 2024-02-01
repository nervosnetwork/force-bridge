import { computeScriptHash } from '@ckb-lumos/base/lib/utils';
import { BigNumber } from 'bignumber.js';
import { ForceBridgeCore } from '../../core';
import { fromHexString, stringToUint8Array, toHexString } from '../../utils';
import { SerializeForceBridgeLockscriptArgs } from '../tx-helper/generated/force_bridge_lockscript';
import { ScriptLike } from './script';

export enum ChainType {
  BTC,
  ETH,
  EOS,
  TRON,
  POLKADOT,
}

export abstract class Asset {
  public chainType: ChainType;
  public ownerCellTypeHash: string;

  protected constructor(ownerCellTypeHash?: string) {
    if (ownerCellTypeHash) {
      this.ownerCellTypeHash = ownerCellTypeHash;
      return;
    }

    this.ownerCellTypeHash = ForceBridgeCore.ckb.utils.scriptToHash(<CKBComponents.Script>{
      codeHash: ForceBridgeCore.config.ckb.ownerCellTypescript.codeHash,
      hashType: ForceBridgeCore.config.ckb.ownerCellTypescript.hashType,
      args: ForceBridgeCore.config.ckb.ownerCellTypescript.args,
    });
  }

  public toTypeScript(): ScriptLike {
    const bridgeCellLockscript = {
      codeHash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
      hashType: ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
      args: this.toBridgeLockscriptArgs(),
    };
    return new ScriptLike(
      ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash,
      computeScriptHash(bridgeCellLockscript),
      ForceBridgeCore.config.ckb.deps.sudtType.script.hashType,
    );
  }

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
        const humanizedAmount = new BigNumber(amount).times(new BigNumber(10).pow(-asset.decimal)).toString();
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
        return new BigNumber(amount).times(new BigNumber(10).pow(asset.decimal)).toString();
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

export function getAsset(chain: number, asset: string): Asset {
  switch (chain) {
    case ChainType.ETH: {
      return new EthAsset(asset);
    }
    default:
      throw new Error(`chainType ${ChainType} not supported yet`);
  }
}

export class EthAsset extends Asset {
  // '0x00000000000000000000' represents ETH
  // other address represents ERC20 address
  constructor(public address: string, ownerCellTypeHash = '') {
    super(ownerCellTypeHash);
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
