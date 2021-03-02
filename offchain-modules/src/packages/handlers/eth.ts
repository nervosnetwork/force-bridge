import { EthDb } from '../db';
import { logger } from '../utils/logger';
import { asyncSleep } from '../utils';

export class EthHandler {
  constructor(private db: EthDb) {}

  // listen ETH chain and handle the new lock events
  async watchLockEvents() {
    while (true) {
      logger.debug('get new lock events and save to db');
      await asyncSleep(3000);
    }
  }

  // watch the eth_unlock table and handle the new unlock events
  // send tx according to the data
  async watchUnlockEvents() {
    while (true) {
      logger.debug('get new unlock events and send tx');
      await asyncSleep(3000);
    }
  }

  start() {
    this.watchLockEvents();
    this.watchUnlockEvents();
    logger.info('eth handler started  🚀');
  }
}
