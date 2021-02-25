export enum ChainType {
  btc,
  eth,
  eos,
  tron,
  polkadot,
}

export abstract class Asset {
  public chainType: ChainType;
  abstract toBridgeLockscriptArgs(): string;
}

export class EthAsset extends Asset {
  // '0x00000000000000000000' represents ETH
  // other address represents ERC20 address
  constructor(public address: string) {
    if (!address.startsWith('0x') || address.length !== 42) {
      throw new Error('invalid ETH asset address');
    }
    this.chainType = ChainType.eth;
  }

  toBridgeLockscriptArgs(): string {
    return `0x01${this.address.slice(2)}`;
  }
}
