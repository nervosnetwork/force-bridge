import { CkbDb } from '../db';
import { CkbBurn, EthUnlock, transformBurnEvent } from '../db/model';
import { logger } from '../utils/logger';
import { asyncSleep } from '../utils';

// CKB handler
// 1. Listen CKB chain to get new burn events.
// 2. Listen database to get new mint events, send tx.
export class CkbHandler {
  constructor(private db: CkbDb) {}

  // save unlock event first and then
  async saveBurnEvent(burn: CkbBurn): Promise<void> {
    logger.debug('save burn event');
    // const unlock = await transformBurnEvent(burn);
    // switch (unlock.name) {
    //   case 'EthUnlock': {
    //     await this.db.createEthUnlock([unlock]);
    //     break;
    //   }
    //   default: {
    //     throw new Error(`wrong unlock type: ${unlock.name}`);
    //   }
    // }
    // await this.db.saveCkbBurn([burn]);
  }

  async watchBurnEvents(): Promise<never> {
    // get cursor from db, usually the block height, to start the poll or subscribe
    // invoke saveBurnEvent when get new one
    while (true) {
      logger.debug('get new burn events and save to db');
      await asyncSleep(3000);
    }
  }

  async watchMintEvents(): Promise<never> {
    while (true) {
      // const mintEvents = await this.db.getCkbMintRecordsToMint();
      logger.debug('new mintEvents');
      await asyncSleep(3000);
      // send tx with this mint events, update db status when finish or throw error
    }
  }

  start() {
    this.watchBurnEvents();
    this.watchMintEvents();
    logger.info('ckb handler started 🚀');
  }
}
