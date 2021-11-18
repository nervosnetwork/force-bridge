import { ApiTransaction } from 'cardano-wallet-js';
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

export class AdaHandler {
  private handledSlot: number;
  constructor(
    private adaDb: AdaDb,
    private feeDb: BridgeFeeDB,
    private kvDb: KVDb,
    private adaChain: AdaChain,
    private role: forceBridgeRole,
  ) {}

  getHandledBlock(): { height: number; hash: string } {
    return { height: this.handledSlot, hash: '' };
  }

  async getTipBlock(): Promise<{ height: number; hash: string }> {
    const { network } = await this.adaChain.getCurrentSlotNumber();
    return { height: network, hash: '' };
  }

  async handleTx(tx: ApiTransaction, currentHeight: number): Promise<void> {
    if (tx.direction === 'incoming') {
      logger.debug('AdaHandler: incoming tx:', tx);
      if (tx.metadata == null || tx.metadata['0'] == null || tx.metadata['0']['string'] == null) {
        logger.error('AdaHandler: BridgeIn Tx does not have metadata', tx.metadata);
        return;
      }
      const recipient = tx.metadata['0']['string'];
      await this.handleTxBridgeIn(tx, recipient, currentHeight);
    } else {
      // direction == outgoing
      const ckbTxHashes = Object.entries(tx.metadata);
      if (ckbTxHashes.length > tx.outputs.length) {
        logger.error('AdaHandler: BridgeOut Tx invalid metadata', tx.metadata, tx.outputs);
        return;
      }
      for (const keyVal of ckbTxHashes) {
        const outputIndex = Number(keyVal[0]);
        let ckbTxHash: string;
        const value = keyVal[1];
        if (typeof value === 'object' && value !== null && value['bytes'] !== undefined) {
          ckbTxHash = '0x' + value['bytes'];
        } else {
          continue;
        }
        const output = tx.outputs[outputIndex];
        const recipient = output.address;
        const amount = output.amount.quantity;
        await this.onUnlockTx(tx, recipient, amount, ckbTxHash);
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
    let txTime: string;
    let insertedAt: number;
    if (tx.inserted_at != undefined) {
      insertedAt = tx.inserted_at.absolute_slot_number;
      txTime = tx.inserted_at.time;
    } else {
      throw new Error(`handleTxBridgeIn: tx.inserted_at is undefined`);
    }
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
      const bridgeFee = 1000; // asset.getBridgeFee('in');
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
    logger.info(`AdaHandler watchNewTransactions init`);
    let { lastConfirmedTxTime, lastConfirmedTxHash } = await this.adaDb.getLatestBlockTime();
    foreverPromise(
      async () => {
        const { node } = await this.adaChain.getCurrentSlotNumber();
        // Assuming that the cardano-wallet has collected all data from node
        const currentHeight = node;
        logger.info('AdaHandler, currentHeight', currentHeight);
        const txs = await this.adaChain.getTransactions(lastConfirmedTxTime);
        txs.reverse(); // recieved list is always descending in order

        for (const tx of txs) {
          switch (tx.status) {
            case 'expired': {
              logger.info(`watchNewTransactions: Ignoring tx with id ${tx.id}, as its status is ${tx.status}`);
              break; // Ignore this tx
            }
            case 'pending': {
              logger.info(`watchNewTransactions: Ignoring tx with id ${tx.id}, as its status is ${tx.status}`);
              break; // Ignore this tx
            }
            // eslint-disable-next-line
            // @ts-ignore
            case 'submitted': {
              // The cardano-wallet-js lib does not have submitted
              logger.info(`watchNewTransactions: Ignoring tx with id ${tx.id}, as its status is ${tx.status}`);
              break; // Ignore this tx
            }
            case 'in_ledger': {
              if (tx.inserted_at != undefined) {
                const insertedAt = tx.inserted_at.absolute_slot_number;
                const confirmedNumber = currentHeight - insertedAt;
                const confirmed = confirmedNumber >= ForceBridgeCore.config.ada.confirmNumber;
                await this.handleTx(tx, currentHeight);
                if (confirmed) {
                  lastConfirmedTxTime = tx.inserted_at.time;
                  lastConfirmedTxHash = tx.id;
                }
              } else {
                throw new Error('watchNewTransactions: tx.inserted_at in undefined');
              }
              break;
            }
            default:
              throw new Error(`watchNewTransactions: tx.status unexpected: ${tx.status}`);
          }
        }
        this.handledSlot = currentHeight;
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
        // if (!this.syncedToStartTipBlockHeight()) { // TODO: Is this needed?
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

        records.map((r) => {
          r.status = 'success';
        });

        logger.info('sendUnlockTxs res', txRes);

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

  private async onUnlockTx(tx: ApiTransaction, recipient: string, amount: number, ckbTxHash: string): Promise<void> {
    await retryPromise(
      async () => {
        let insertedAt: number;
        if (tx.inserted_at != undefined) {
          insertedAt = tx.inserted_at.absolute_slot_number;
        } else {
          throw new Error(`onUnlockTx: tx.inserted_at is undefined`);
        }
        const unlockTxHash = tx.id;
        const token = 'ada';
        logger.info(
          `AdaHandler watchUnlockEvents slot:${insertedAt} txHash:${unlockTxHash} amount:${amount} recipient:${recipient} ckbTxHash:${ckbTxHash}`,
        );
        await this.adaDb.createAdaUnlock([
          {
            ckbTxHash: ckbTxHash,
            amount: amount.toString(),
            asset: token,
            recipientAddress: recipient,
            blockNumber: insertedAt,
            adaTxHash: unlockTxHash,
          },
        ]);
        await this.adaDb.updateBurnBridgeFee(ckbTxHash, amount.toString());
        if (this.role === 'collector') {
          await this.adaDb.updateCollectorUnlockStatus(ckbTxHash, insertedAt, 'success');
        }
        BridgeMetricSingleton.getInstance(this.role).addBridgeTokenMetrics('ada_unlock', [
          {
            amount: Number(amount),
            token: token,
          },
        ]);
      },
      {
        onRejected: (e: Error) => {
          logger.error(`AdaHandler onUnlockTx error:${e.stack}`);
        },
      },
    );
  }
}
