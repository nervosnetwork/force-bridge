import Burn from './burn';
import Eth from './eth';

export abstract class Factory {
  static fromChainName(chainName: string): Burn {
    switch (chainName) {
      case 'Ethereum':
        return new Eth();
      default:
        throw new Error(`invalid chain type: ${chainName}`);
    }
  }
}
