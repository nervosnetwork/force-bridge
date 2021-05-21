import { ChainType } from '../ckb/model/asset';
import { forceBridgeRole } from '../config';
import { ForceBridgeCore } from '../core';
import { BtcDb } from '../db/btc';
import { BtcUnlock } from '../db/entity/BtcUnlock';
import { asyncSleep } from '../utils';
import { logger } from '../utils/logger';
import { BTCChain, BtcLockData } from '../xchain/btc';

const CkbAddressLen = 46;

export class BtcHandler {
  constructor(private db: BtcDb, private btcChain: BTCChain, private role: forceBridgeRole) {}

  // listen BTC chain and handle the new lock events
  async watchLockEvents() {
    logger.debug('start btc watchLockEvents');
    let latestHeight = await this.db.getLatestHeight();
    while (true) {
      try {
        await asyncSleep(1000 * 60);
        const targetHeight = (await this.btcChain.getBtcHeight()) - ForceBridgeCore.config.btc.confirmNumber;
        if (targetHeight <= latestHeight) {
          continue;
        }
        logger.debug(
          `BtcHandler watchLockEvents db lock record latest height: ${latestHeight}. target height: ${targetHeight}`,
        );
        await this.btcChain.watchBtcTxEvents(
          latestHeight,
          targetHeight,
          async (btcLockEventData: BtcLockData) => {
            logger.info(`BtcHandler watchBtcTxEvents newEvents:${JSON.stringify(btcLockEventData, null, 2)}`);

            if (this.role === 'collector') {
              await this.db.createCkbMint([
                {
                  id: btcLockEventData.txId,
                  chain: ChainType.BTC,
                  amount: btcLockEventData.amount,
                  asset: 'btc',
                  recipientLockscript: btcLockEventData.data.slice(0, CkbAddressLen),
                },
              ]);
              logger.info(`BtcHandler watchBtcTxEvents save CkbMint successful for BTC tx ${btcLockEventData.txHash}.`);
            }

            await this.db.createBtcLock([
              {
                txid: btcLockEventData.txId,
                txIndex: btcLockEventData.txIndex,
                txHash: btcLockEventData.txHash,
                sender: btcLockEventData.sender,
                rawTx: btcLockEventData.rawTx,
                amount: btcLockEventData.amount,
                data: btcLockEventData.data,
                blockHeight: btcLockEventData.blockHeight,
                blockHash: btcLockEventData.blockHash,
              },
            ]);
            logger.info(`BtcHandler watchBtcTxEvents save BTCLock successful for BTC tx ${btcLockEventData.txHash}.`);
          },
          async (ckbTxHash: string) => {
            if (!ckbTxHash.startsWith('0x')) {
              ckbTxHash = '0x' + ckbTxHash;
            }
            const records: BtcUnlock[] = await this.db.getNotSuccessUnlockRecord(ckbTxHash);
            if (records.length === 0) {
              return;
            }
            logger.debug(`BtcHandler watchBtcTxEvents unlockRecords: ${JSON.stringify(records, null, 2)}`);
            if (records.length > 1) {
              throw new Error(
                `there are some unlock record which have the same ckb burn hash.  ${JSON.stringify(records, null, 2)}`,
              );
            }
            records[0].status = 'success';
            await this.db.saveBtcUnlock(records);
          },
        );
        latestHeight = targetHeight;
      } catch (e) {
        logger.error('there is an error occurred during in btc chain watch event', e.toString());
      }
    }
  }

  // watch the BTC_unlock table and handle the new unlock events
  // send tx according to the data
  async watchUnlockEvents() {
    if (this.role !== 'collector') {
      return;
    }
    // todo: get and handle pending and error records
    logger.info('BtcHandler watchUnlockEvents start');
    while (true) {
      await asyncSleep(1000 * 20);
      const records: BtcUnlock[] = await this.db.getBtcUnlockRecords('todo');
      if (records.length === 0) {
        continue;
      }
      logger.debug(
        `BtcHandler watchUnlockEvents get btc unlock record and send tx ${JSON.stringify(records, null, 2)}`,
      );
      try {
        // write db first, avoid send tx success and fail to write db
        records.map((r) => {
          r.status = 'pending';
        });
        await this.db.saveBtcUnlock(records);
        const txRes = await this.btcChain.sendUnlockTxs(records);
        records.map((r) => {
          r.status = 'pending';
          r.btcTxHash = txRes.txHash;
        });
        await this.db.saveBtcUnlock(records);
      } catch (e) {
        records.map((r) => {
          r.status = 'error';
          r.message = e.message;
        });
        await this.db.saveBtcUnlock(records);
        logger.error(
          `BtcHandler watchUnlockEvents there is an error occurred during in btc chain send unlock.`,
          e.toString(),
        );
      }
    }
  }

  start() {
    this.watchLockEvents();
    this.watchUnlockEvents();
    logger.info('BTC handler started  🚀');
  }
}
