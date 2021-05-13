import { EthDb } from '../db';
import { logger } from '../utils/logger';
import { asyncSleep, fromHexString, uint8ArrayToString } from '../utils';
import { EthUnlock } from '@force-bridge/db/model';
import { ChainType } from '@force-bridge/ckb/model/asset';
import { EthUnlockStatus } from '@force-bridge/db/entity/EthUnlock';
import { EthChain } from '@force-bridge/xchain/eth';

export class EthHandler {
  constructor(private db: EthDb, private ethChain: EthChain) {}

  // listen ETH chain and handle the new lock events
  async watchLockEvents() {
    const latestHeight = await this.db.getLatestHeight();
    logger.debug('EthHandler watchLockEvents latestHeight: ', latestHeight);
    await this.ethChain.watchLockEvents(latestHeight, async (log, parsedLog) => {
      try {
        logger.info(
          `EthHandler watchLockEvents receiveLog txHash:${
            log.transactionHash
          } amount:${parsedLog.args.lockedAmount.toString()} asset:${parsedLog.args.token} recipientLockscript:${
            parsedLog.args.recipientLockscript
          } sudtExtraData:${parsedLog.args.sudtExtraData} sender:${parsedLog.args.sender}`,
        );
        logger.debug('EthHandler watchLockEvents eth lockEvtLog:', { log, parsedLog });
        const amount = parsedLog.args.lockedAmount.toString();
        if (amount === '0') {
          return;
        }
        await this.db.createCkbMint([
          {
            id: log.transactionHash,
            chain: ChainType.ETH,
            amount: amount,
            asset: parsedLog.args.token,
            recipientLockscript: uint8ArrayToString(fromHexString(parsedLog.args.recipientLockscript)),
            sudtExtraData: parsedLog.args.sudtExtraData,
          },
        ]);
        await this.db.createEthLock([
          {
            txHash: log.transactionHash,
            amount: amount,
            token: parsedLog.args.token,
            recipient: uint8ArrayToString(fromHexString(parsedLog.args.recipientLockscript)),
            sudtExtraData: parsedLog.args.sudtExtraData,
            blockNumber: log.blockNumber,
            blockHash: log.blockHash,
            sender: parsedLog.args.sender,
          },
        ]);
        logger.info(
          `EthHandler watchLockEvents save CkbMint and EthLock successful for eth tx ${log.transactionHash}.`,
        );
      } catch (e) {
        logger.error(`EthHandler watchLockEvents error: ${e.toString()}`);
        await asyncSleep(3000);
      }
    });
  }

  async getUnlockRecords(status: EthUnlockStatus): Promise<EthUnlock[]> {
    return this.db.getEthUnlockRecordsToUnlock(status);
  }
  // watch the eth_unlock table and handle the new unlock events
  // send tx according to the data
  async watchUnlockEvents() {
    // todo: get and handle pending and error records
    while (true) {
      await asyncSleep(15000);
      logger.debug('EthHandler watchLockEvents get new unlock events and send tx');
      const records = await this.getUnlockRecords('todo');
      if (records.length === 0) {
        continue;
      }
      logger.info('EthHandler watchLockEvents unlock records', records);

      const unlockTxHashes = records
        .map((unlockRecord) => {
          return unlockRecord.ckbTxHash;
        })
        .join(', ');
      logger.info(
        `EthHandler watchLockEvents start process unlock Record, ckbTxHashes:${unlockTxHashes} num:${records.length}`,
      );

      try {
        // write db first, avoid send tx success and fail to write db
        records.map((r) => {
          r.status = 'pending';
        });
        await this.db.saveEthUnlock(records);
        const txRes = await this.ethChain.sendUnlockTxs(records);
        records.map((r) => {
          r.status = 'pending';
          r.ethTxHash = txRes.hash;
        });
        await this.db.saveEthUnlock(records);
        logger.debug('sendUnlockTxs res', txRes);
        const receipt = await txRes.wait();
        logger.info(`EthHandler watchLockEvents sendUnlockTxs receipt:${JSON.stringify(receipt.logs, null, 2)}`);
        if (receipt.status === 1) {
          records.map((r) => {
            r.status = 'success';
          });
        } else {
          records.map((r) => {
            r.status = 'error';
          });
          logger.error('EthHandler watchLockEvents unlock execute failed:', receipt);
        }
        await this.db.saveEthUnlock(records);
        logger.info('EthHandler watchLockEvents process unlock Record completed');
      } catch (e) {
        records.map((r) => {
          r.status = 'error';
          r.message = e.message;
        });
        await this.db.saveEthUnlock(records);
        logger.error(`EthHandler watchLockEvents error:${e.toString()}`);
      }
    }
  }

  start() {
    this.watchLockEvents();
    this.watchUnlockEvents();
    logger.info('eth handler started  🚀');
  }
}
