import { ChainType } from '../ckb/model/asset';
import { forceBridgeRole } from '../config';
import { ForceBridgeCore } from '../core';
import { AdaDb, KVDb, BridgeFeeDB } from '../db';
import { AdaUnlockStatus } from '../db/entity/AdaUnlock';
import { AdaUnlock, IAdaUnlock } from '../db/model';
import { BridgeMetricSingleton, txTokenInfo } from '../metric/bridge-metric';
import { asyncSleep, foreverPromise, fromHexString, retryPromise, uint8ArrayToString } from '../utils';
import { logger } from '../utils/logger';
import { AdaChain } from '../xchain/ada';
import { ApiTransaction } from 'cardano-wallet-js';

export class AdaHandler {
  constructor(
    private adaDb: AdaDb,
    private feeDb: BridgeFeeDB,
    private kvDb: KVDb,
    private adaChain: AdaChain,
    private role: forceBridgeRole,
  ) {}

  async handleTx(tx: ApiTransaction, currentHeight: number): Promise<void> {
    if (tx.direction === 'incoming') {
      logger.debug('AdaHandler: incoming tx:', tx);
      if (tx.metadata == null || tx.metadata['0'] == null || tx.metadata['0']['string'] == null) {
        logger.error('AdaHandler: BridgeIn Tx does not have metadata', tx.metadata);
        return
      }
      const recipient = tx.metadata['0']['string'];
      await this.handleTxBridgeIn(tx, recipient, currentHeight);
    } else { // direction == outgoing
      for (let output of tx.outputs) {
        if (output.address == this.adaChain.bridgeMultiSigAddr) {
          // change
          continue;
        } else {
          const recipient = output.address;
          const amount = output.amount.quantity;
          logger.info('AdaHandler: OutTx observed', recipient, amount);
          // TODO: add to DB along with the CkbTxHash data
        }
      }
    }
  }

  async handleTxBridgeIn(tx: ApiTransaction, recipient: string, currentHeight: number): Promise<void> {
    const uniqueId = tx.id;
    const records = await this.adaDb.getAdaLocksByUniqueIds([uniqueId]);
    if (records.length > 1) {
      logger.error('unexpected db find error', records);
      throw new Error(`unexpected db find error, records.length = ${records.length}`);
    }

    // @ts-ignore
    const insertedAt: number = tx.inserted_at.absolute_slot_number;
    // @ts-ignore
    const txTime = tx.inserted_at.time;
    const confirmedNumber = currentHeight - insertedAt;
    const confirmed = confirmedNumber >= ForceBridgeCore.config.ada.confirmNumber;
    const confirmStatus = confirmed ? 'confirmed' : 'unconfirmed';
    // create new AdaLock record
    const txHash = tx.id;
    const amount = tx.amount.quantity;
    const token = 'ada';
    const sudtExtraData = ''; // TODO: is this needed?
    const blockNumber = insertedAt;
    // There could be multiple inputs to a Tx, therefore this is not useful.
    const sender = tx.inputs[0].id + '#' + tx.inputs[0].index;
    if (records.length === 0) {
      await this.adaDb.createAdaLock([
        {
          txHash,
          amount,
          token,
          recipient,
          sudtExtraData,
          blockNumber,
          txTime,
          sender,
          uniqueId,
          bridgeFee: '0',
          confirmNumber: confirmedNumber,
          confirmStatus,
        },
      ]);
      BridgeMetricSingleton.getInstance(this.role).addBridgeTxMetrics('ada_lock', 'success');
      BridgeMetricSingleton.getInstance(this.role).addBridgeTokenMetrics('ada_lock', [
        {
          amount: Number(amount),
          token: token,
        },
      ]);
      await this.adaDb.updateBridgeInRecord(uniqueId, amount, token, recipient, sudtExtraData);
      logger.info(`AdaHandler watchLockEvents save AdaLock successful for ada tx ${tx.id}.`);
    }
    if (records.length === 1) {
      await this.adaDb.updateLockConfirmNumber([{ uniqueId, confirmedNumber, confirmStatus }]);
      logger.info(`update lock record ${txHash} status, confirmed number: ${confirmedNumber}, status: ${confirmed}`);
    }
    if (confirmed && this.role === 'collector') {
      // TODO: calculate bridgeFee
      const bridgeFee = 1000;// asset.getBridgeFee('in');
      const mintRecords = {
        id: uniqueId,
        lockBlockHeight: blockNumber,
        chain: ChainType.CARDANO,
        amount: (BigInt(amount) - BigInt(bridgeFee)).toString(),
        asset: token,
        recipientLockscript: recipient,
        sudtExtraData,
      };
      await this.adaDb.createCollectorCkbMint([mintRecords]);
      logger.info(`save CkbMint successful for ada tx ${txHash}`);
    }
  }

  async watchNewTransactions(): Promise<void> {
    logger.info(
      `AdaHandler watchNewTransactions init`,
    );
    let {lastSeenTxTime, lastSeenTxHash} = await this.adaDb.getLatestBlockTime();
    foreverPromise(
      async () => {
        let currentHeight = await this.adaChain.getCurrentSlotNumber();
        logger.info('AdaHandler, currentHeight', currentHeight);
        let txs = await this.adaChain.getTransactions(lastSeenTxTime);
        txs.reverse(); // recieved list is always descending in order
        if (lastSeenTxTime !== undefined && txs.length > 0) {
          if (txs[0].id == lastSeenTxHash) {
            txs.shift(); // remove the already handled tx
          } else {
            logger.error(`AdaHandler watchNewTransactions: expected txHash ${lastSeenTxHash}, but got ${txs[0].id}`);
          }
        }

        for (let tx of txs) {
          await this.handleTx(tx, currentHeight);
          // @ts-ignore
          lastSeenTxTime = tx.inserted_at.time;
          // @ts-ignore
          lastSeenTxHash = tx.id;
        }
        // await asyncSleep(15000);
      },
      {
        onRejectedInterval: 15000,
        onResolvedInterval: 15000,
        onRejected: (e: Error) => {
          logger.error(`AdaHandler watchNewTransactions error:${e.stack}`);
        },
      },
    );
  }

  start(): void {
    void this.watchNewTransactions();

    this.handleUnlockRecords();
    logger.info('ada handler started  🚀');
  }

  // watch the ada_unlock table and handle the new unlock events
  // send tx according to the data
  handleUnlockRecords(): void {
    if (this.role !== 'collector') {
      return;
    }
    this.handleTodoUnlockRecords();
  }

  handleTodoUnlockRecords(): void {
    foreverPromise(
      async () => {
        // if (!this.syncedToStartTipBlockHeight()) {
        //   logger.info(
        //     `wait until syncing to startBlockHeight, lastHandledBlockHeight: ${this.lastHandledBlockHeight}, startTipBlockHeight: ${this.startTipBlockHeight}`,
        //   );
        //   return;
        // }
        logger.debug('AdaHandler watchUnlockEvents get new unlock events and send tx');
        const records = await this.getUnlockRecords('todo');
        if (records.length === 0) {
          logger.info('wait for todo unlock records');
          return;
        }
        logger.info(`AdaHandler watchUnlockEvents unlock records: ${JSON.stringify(records)}`);
        await this.doHandleUnlockRecords(records);
      },
      {
        onRejectedInterval: 15000,
        onResolvedInterval: 15000,
        onRejected: (e: Error) => {
          logger.error(`ADA handleTodoUnlockRecords error:${e.stack}`);
        },
      },
    );
  }

  async doHandleUnlockRecords(records: IAdaUnlock[]): Promise<void> {
    if (records.length === 0) {
      return;
    }

    const unlockTxHashes = records
      .map((unlockRecord) => {
        return unlockRecord.ckbTxHash;
      })
      .join(', ');
    logger.info(
      `AdaHandler doHandleUnlockRecords start process unlock Record, ckbTxHashes:${unlockTxHashes} num:${records.length}`,
    );

    for (;;) {
      try {
        // write db first, avoid send tx success and fail to write db
        records.map((r) => {
          r.status = 'pending';
        });
        await this.adaDb.saveCollectorAdaUnlock(records);
        const txRes = await this.adaChain.sendUnlockTxs(records);
        if (typeof txRes === 'boolean') {
          records.map((r) => {
            r.status = 'success';
          });
          break;
        }
        if (txRes instanceof Error) {
          if (records.length > 1) {
            logger.warn(`split batch unlock into separate ones for records: ${JSON.stringify(records)}`);
            for (const r of records) {
              await this.doHandleUnlockRecords([r]);
            }
            return;
          }
          records.map((r) => {
            r.status = 'error';
            r.message = (txRes as Error).message;
          });
          BridgeMetricSingleton.getInstance(this.role).addBridgeTxMetrics('ada_unlock', 'failed');
          logger.error(
            `AdaHandler doHandleUnlockRecords ckbTxHashes:${unlockTxHashes}  sendUnlockTxs error:${txRes as Error}`,
          );
          break;
        }

        await this.adaDb.saveCollectorAdaUnlock(records);

        // TODO: check Tx status again?
        records.map((r) => {
          r.status = 'success';
        });

        logger.debug('sendUnlockTxs res', txRes);

        const unlockTokens = records.map((r) => {
          const tokenInfo: txTokenInfo = {
            amount: Number(r.amount),
            token: r.asset,
          };
          return tokenInfo;
        });
        BridgeMetricSingleton.getInstance(this.role).addBridgeTokenMetrics('ada_unlock', unlockTokens);
        BridgeMetricSingleton.getInstance(this.role).addBridgeTxMetrics('ada_unlock', 'success');

        break;
      } catch (e) {
        logger.error(`AdaHandler doHandleUnlockRecords ckbTxHashes:${unlockTxHashes} error:${e.stack}`);
        await asyncSleep(5000);
      }
    }
    for (;;) {
      try {
        await this.adaDb.saveCollectorAdaUnlock(records);
        logger.info(`AdaHandler doHandleUnlockRecords process unlock Record completed ckbTxHashes:${unlockTxHashes}`);
        break;
      } catch (e) {
        logger.error(
          `AdaHandler doHandleUnlockRecords db.saveAdaUnlock ckbTxHashes:${unlockTxHashes} error:${e.stack}`,
        );
        await asyncSleep(3000);
      }
    }
  }

  async getUnlockRecords(status: AdaUnlockStatus): Promise<AdaUnlock[]> {
    const toUnlockRecords = await this.adaDb.getAdaUnlockRecordsToUnlock(status);
    const unlockedRecords = (await this.adaDb.getAdaUnlockByCkbTxHashes(toUnlockRecords.map((r) => r.ckbTxHash))).map(
      (r) => r.ckbTxHash,
    );
    if (unlockedRecords.length > 0) {
      await this.adaDb.setCollectorAdaUnlockToSuccess(unlockedRecords);
      return toUnlockRecords.filter((r) => unlockedRecords.indexOf(r.ckbTxHash) < 0);
    } else {
      return toUnlockRecords;
    }
  }
}
