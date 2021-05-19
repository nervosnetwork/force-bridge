import { EventEmitter } from 'events';
import { Amount } from '@lay2/pw-core';
import { Asset, ChainType } from './ckb/model/asset';

export type EthLockEvent = {
  name: 'EthLockEvent';
};

// emit when we have an asset to mint on CKB
export type MintEvent = {
  name: 'MintEvent';
  chainType: ChainType;
  asset: Asset;
  amount: Amount;
  recipientAddress: string;
  sudtExtraData: string;
};

// emit when we burn some sudt on CKB
export type BurnEvent = {
  name: 'BurnEvent';
  chainType: ChainType;
  asset: Asset;
  amount: Amount;
  memo: string;
};

export interface EventMap {
  toMint: MintEvent;
  burn: BurnEvent;
}

export type EthUnlockEvent = {
  name: 'EthUnlockEvent';
};

export type Event = MintEvent | BurnEvent;

export class ForceBridgeEventEmitter {
  constructor(private emitter: EventEmitter) {
    this.emitter = new EventEmitter();
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  addHandler(type: string, handler: (Event) => void) {
    this.emitter.on(type, handler);
  }

  emit<K extends keyof EventMap>(type: K, myEvent: EventMap[K]): void {
    this.emitter.emit(type, myEvent);
  }
}
