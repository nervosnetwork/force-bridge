import { logger } from '../utils/logger';
import { asyncSleep } from '../utils';
import { ChainType } from '@force-bridge/ckb/model/asset';
import { BTCChain, BtcLockData } from '@force-bridge/xchain/btc';
import { BtcDb } from '@force-bridge/db/btc';

export class BtcHandler {
  constructor(private db: BtcDb, private btcChain: BTCChain) {}

  // listen ETH chain and handle the new lock events
  async watchLockEvents() {
    const latestHeight = await this.db.getLatestHeight();
    logger.debug('latestHeight: ', latestHeight);
    const nowTips = await this.btcChain.getBtcHeight();
    this.btcChain.watchLockEvents(latestHeight, nowTips, async (btcLockEventData: BtcLockData) => {
      logger.debug('btc lock event data :', btcLockEventData);
      await this.db.createCkbMint([
        {
          id: btcLockEventData.txId,
          chain: ChainType.BTC,
          amount: btcLockEventData.amount,
          asset: 'btc',
          recipientLockscript: btcLockEventData.data,
        },
      ]);
      await this.db.createBtcLock([
        {
          txid: btcLockEventData.txId,
          txIndex: btcLockEventData.txIndex,
          txHash: btcLockEventData.txHash,
          rawTx: btcLockEventData.rawTx,
          amount: btcLockEventData.amount,
          receiptAddress: btcLockEventData.data,
          blockHeight: btcLockEventData.blockHeight,
          blockHash: btcLockEventData.blockHash,
        },
      ]);
      logger.debug(`save CkbMint and BTCLock successful for BTC tx ${btcLockEventData.txHash}.`);
    });
  }

  // watch the BTC_unlock table and handle the new unlock events
  // send tx according to the data
  async watchUnlockEvents() {
    // todo: get and handle pending and error records
    while (true) {
      await asyncSleep(15000);
      logger.debug('get new unlock events and send tx');
      const records = await this.db.getBtcUnlockRecords('todo');
      logger.debug('unlock records', records);
      if (records.length === 0) {
        continue;
      }
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
        logger.debug('sendUnlockTxs ', txRes);
        // const receipt = await txRes.wait();
        // if (receipt.status === 1) {
        //   records.map((r) => {
        //     r.status = 'success';
        //   });
        // } else {
        //   records.map((r) => {
        //     r.status = 'error';
        //   });
        //   logger.error('unlock execute failed', receipt);
        // }
        // await this.db.saveBTCUnlock(records);
        // logger.debug('sendUnlockTxs receipt', receipt);
      } catch (e) {
        records.map((r) => {
          r.status = 'error';
          r.message = e.message;
        });
        await this.db.saveBtcUnlock(records);
      }
    }
  }

  start() {
    this.watchLockEvents();
    this.watchUnlockEvents();
    logger.info('BTC handler started  🚀');
  }
}
