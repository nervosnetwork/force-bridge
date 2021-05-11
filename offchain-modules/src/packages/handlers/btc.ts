import { logger } from '@force-bridge/utils/logger';
import { asyncSleep } from '@force-bridge/utils';
import { ChainType } from '@force-bridge/ckb/model/asset';
import { BTCChain, BtcLockData } from '@force-bridge/xchain/btc';
import { BtcDb } from '@force-bridge/db/btc';
import { BtcUnlock } from '@force-bridge/db/entity/BtcUnlock';
import { ForceBridgeCore } from '@force-bridge/core';

const CkbAddressLen = 46;

export class BtcHandler {
  constructor(private db: BtcDb, private btcChain: BTCChain) {}

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
            await this.db.createCkbMint([
              {
                id: btcLockEventData.txId,
                chain: ChainType.BTC,
                amount: btcLockEventData.amount,
                asset: 'btc',
                recipientLockscript: btcLockEventData.data.slice(0, CkbAddressLen),
              },
            ]);
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
            logger.info(
              `BtcHandler watchBtcTxEvents save CkbMint and BTCLock successful for BTC tx ${btcLockEventData.txHash}.`,
            );
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
