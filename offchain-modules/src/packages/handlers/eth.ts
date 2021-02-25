import { EthDb } from '../db';
import { logger } from '../utils/logger';

export class EthHandler {
  constructor(private db: EthDb) {}

  // listen ETH chain and handle the new lock events
  watchLockEvents() {}

  // watch the eth_unlock table and handle the new unlock events
  // send tx according to the data
  watchUnlockEvents() {}

  start() {
    this.watchLockEvents();
    this.watchUnlockEvents();
    logger.info('eth handler started  🚀');
  }
}
