export enum ChainType {
  BTC,
  ETH,
  EOS,
  TRON,
  POLKADOT,
}

export abstract class Asset {
  public chainType: ChainType;
  abstract toBridgeLockscriptArgs(): string;
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
}
