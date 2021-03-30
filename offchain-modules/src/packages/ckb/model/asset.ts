import { stringToUint8Array, toHexString } from '../../utils';

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
  constructor(public address: string) {
    super();
    if (!address.startsWith('0x') || address.length !== 42) {
      throw new Error('invalid ETH asset address');
    }
    this.chainType = ChainType.ETH;
  }

  toBridgeLockscriptArgs(): string {
    return `0x01${this.address.slice(2)}`;
  }

  getAddress(): string {
    return this.address;
  }
}

export class TronAsset extends Asset {
  // '0x00000000000000000000' represents ETH
  // other address represents ERC20 address
  constructor(public address: string) {
    super();
    // if (!address.startsWith('') || address.length !== 42) {
    //   throw new Error('invalid Tron asset address');
    // }
    this.chainType = ChainType.TRON;
  }

  toBridgeLockscriptArgs(): string {
    return `0x03${toHexString(stringToUint8Array(this.address))}`;
  }

  getAddress(): string {
    return this.address;
  }
}

export class EosAsset extends Asset {
  // '0x00000000000000000000' represents ETH
  // other address represents ERC20 address
  constructor(public address: string) {
    super();
    // if (!address.startsWith('') || address.length !== 42) {
    //   throw new Error('invalid Tron asset address');
    // }
    this.chainType = ChainType.EOS;
  }

  toBridgeLockscriptArgs(): string {
    return `0x02${toHexString(stringToUint8Array(this.address))}`;
  }

  getAddress(): string {
    return this.address;
  }
}
