import { Universal } from '@force-bridge/reconc';

export const KEY_NETWORK = 'Ethereum';

function unimplemented(): never {
  throw new Error('unimplemented');
}

abstract class UniversalEthResource implements Universal {
  readonly network = KEY_NETWORK;

  protected constructor(protected readonly address: string) {}

  identityXChain(): string {
    return this.address;
  }

  abstract identityNervos(): string;
}

export class EthAccount extends UniversalEthResource {
  identityNervos(): string {
    // use pw lock here
    unimplemented();
  }
}

export class EthFungibleAsset extends UniversalEthResource {
  identityNervos(): string {
    unimplemented();
  }
}
