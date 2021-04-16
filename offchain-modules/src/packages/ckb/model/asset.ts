import { fromHexString, stringToUint8Array, toHexString } from '../../utils';
import { SerializeForceBridgeLockscriptArgs } from '../../ckb/tx-helper/generated/force_bridge_lockscript';

export enum ChainType {
  BTC,
  ETH,
  EOS,
  TRON,
  POLKADOT,
}

export abstract class Asset {
  public chainType: ChainType;
  public abstract toBridgeLockscriptArgs(): string;
  public abstract getAddress(): string;
}

export class EthAsset extends Asset {
  // '0x00000000000000000000' represents ETH
  // other address represents ERC20 address
  constructor(public address: string, public ownLockHash: string) {
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
      asset: fromHexString(this.address).buffer,
    };
    return `0x${toHexString(new Uint8Array(SerializeForceBridgeLockscriptArgs(params)))}`;
  }

  getAddress(): string {
    return this.address;
  }
}

export class TronAsset extends Asset {
  constructor(public address: string, public ownLockHash: string) {
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
    return toHexString(stringToUint8Array(this.address));
  }
}

export class EosAsset extends Asset {
  constructor(public address: string, public ownLockHash: string) {
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
    return toHexString(stringToUint8Array(this.address));
  }
}

export class BtcAsset extends Asset {
  constructor(public address: string, public ownLockHash: string) {
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
    return toHexString(stringToUint8Array(this.address));
  }
}
