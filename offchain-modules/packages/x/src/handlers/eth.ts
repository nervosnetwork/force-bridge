import { ChainType } from '../ckb/model/asset';
import { EthDb } from '../db';
import { EthUnlockStatus } from '../db/entity/EthUnlock';
import { EthUnlock } from '../db/model';
import { asyncSleep, fromHexString, uint8ArrayToString } from '../utils';
import { logger } from '../utils/logger';
import { EthChain } from '../xchain/eth';

export class EthHandler {
  constructor(private db: EthDb, private ethChain: EthChain) {}

  // listen ETH chain and handle the new lock events
  async watchLockEvents() {
    const latestHeight = await this.db.getLatestHeight();
    logger.debug('latestHeight: ', latestHeight);
    await this.ethChain.watchLockEvents(latestHeight, async (log, parsedLog) => {
      try {
        logger.debug('log:', { log, parsedLog });
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
        logger.debug(`save CkbMint and EthLock successful for eth tx ${log.transactionHash}.`);
      } catch (e) {
        logger.error(`EthHandler watchLockEvents error: ${e}`);
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
      logger.debug('get new unlock events and send tx');
      const records = await this.getUnlockRecords('todo');
      logger.debug('unlock records', records);
      if (records.length === 0) {
        continue;
      }
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
        if (receipt.status === 1) {
          records.map((r) => {
            r.status = 'success';
          });
        } else {
          records.map((r) => {
            r.status = 'error';
          });
          logger.error('unlock execute failed', receipt);
        }
        await this.db.saveEthUnlock(records);
        logger.debug('sendUnlockTxs receipt', receipt);
      } catch (e) {
        records.map((r) => {
          r.status = 'error';
          r.message = e.message;
        });
        await this.db.saveEthUnlock(records);
      }
    }
  }

  start() {
    this.watchLockEvents();
    this.watchUnlockEvents();
    logger.info('eth handler started  🚀');
  }
}
