import { BigNumber, ethers } from 'ethers';
import { ChainType, EthAsset } from '../ckb/model/asset';
import { forceBridgeRole } from '../config';
import { ForceBridgeCore } from '../core';
import { EthDb, KVDb, BridgeFeeDB } from '../db';
import { EthUnlockStatus } from '../db/entity/EthUnlock';
import { EthUnlock, IEthUnlock } from '../db/model';
import { BridgeMetricSingleton, txTokenInfo } from '../monitor/bridge-metric';
import { ethCollectSignaturesPayload } from '../multisig/multisig-mgr';
import { asyncSleep, foreverPromise, fromHexString, retryPromise, uint8ArrayToString } from '../utils';
import { logger } from '../utils/logger';
import { EthChain, WithdrawBridgeFeeTopic, Log, ParsedLog } from '../xchain/eth';

const MAX_RETRY_TIMES = 3;
const lastHandleEthBlockKey = 'lastHandleEthBlock';

export class EthHandler {
  private lastHandledBlockHeight: number;
  private lastHandledBlockHash: string;

  constructor(
    private ethDb: EthDb,
    private feeDb: BridgeFeeDB,
    private kvDb: KVDb,
    private ethChain: EthChain,
    private role: forceBridgeRole,
  ) {}

  async getLastHandledBlock(): Promise<{ blockNumber: number; blockHash: string }> {
    const lastHandledBlock = await this.kvDb.get(lastHandleEthBlockKey);
    if (!lastHandledBlock) {
      return { blockNumber: 0, blockHash: '' };
    }
    const block = lastHandledBlock.split(',');
    return { blockNumber: parseInt(block[0]), blockHash: block[1] };
  }

  async setLastHandledBlock(blockNumber: number, blockHash: string): Promise<void> {
    this.lastHandledBlockHeight = blockNumber;
    this.lastHandledBlockHash = blockHash;
    await this.kvDb.set(lastHandleEthBlockKey, `${blockNumber},${blockHash}`);
  }

  getHandledBlock(): { height: number; hash: string } {
    return { height: this.lastHandledBlockHeight, hash: this.lastHandledBlockHash };
  }

  async getTipBlock(): Promise<{ height: number; hash: string }> {
    const tipHeight = await this.ethChain.getCurrentBlockNumber();
    const tipBlock = await this.ethChain.getBlock(tipHeight);
    return { height: tipHeight, hash: tipBlock.hash };
  }

  async init(): Promise<void> {
    const currentBlockHeight = await this.ethChain.getCurrentBlockNumber();
    const lastHandledBlock = await this.getLastHandledBlock();
    if (lastHandledBlock.blockNumber === 0) {
      let lastHandledBlockHeight = currentBlockHeight;
      if (ForceBridgeCore.config.eth.startBlockHeight > 0) {
        lastHandledBlockHeight = ForceBridgeCore.config.eth.startBlockHeight;
      }
      const currentBlock = await this.ethChain.getBlock(lastHandledBlockHeight);
      this.lastHandledBlockHash = currentBlock.hash;
      this.lastHandledBlockHeight = currentBlock.number;
    } else {
      this.lastHandledBlockHash = lastHandledBlock.blockHash;
      this.lastHandledBlockHeight = lastHandledBlock.blockNumber;
    }

    logger.info(
      `EthHandler init lastHandledBlock:${this.lastHandledBlockHeight} currentBlockHeight: ${currentBlockHeight}`,
    );

    if (this.lastHandledBlockHeight === currentBlockHeight) {
      return;
    }

    const getLogBatchSize = 100;
    const confirmNumber = ForceBridgeCore.config.eth.confirmNumber;
    const nextBlock = await this.ethChain.getBlock(this.lastHandledBlockHeight + 1);
    if (this.isForked(confirmNumber, nextBlock)) {
      BridgeMetricSingleton.getInstance(this.role).setForkEventHeightMetrics('eth', this.lastHandledBlockHeight);
      logger.warn(
        `EthHandler init nextBlock blockHeight:${nextBlock.number} parentHash:${
          nextBlock.parentHash
        } != lastHandledBlockHash:${this.lastHandledBlockHash} fork occur removeUnconfirmedLock events from:${
          nextBlock.number - confirmNumber
        }`,
      );
      const confirmedBlockHeight = nextBlock.number - confirmNumber;
      const confirmedBlock = await this.ethChain.getBlock(confirmedBlockHeight);
      await this.ethDb.removeUnconfirmedLocks(confirmedBlockHeight);
      await this.feeDb.removeForkedWithdrawFee(confirmedBlockHeight);
      if (this.role !== 'collector') await this.ethDb.removeUnconfirmedUnlocks(confirmedBlockHeight);
      await this.setLastHandledBlock(confirmedBlockHeight, confirmedBlock.hash);
    }

    for (;;) {
      const endBlockNumber =
        this.lastHandledBlockHeight + getLogBatchSize > currentBlockHeight
          ? currentBlockHeight
          : this.lastHandledBlockHeight + getLogBatchSize;

      logger.info(`EthHandler init getLogs from:${this.lastHandledBlockHeight} to:${endBlockNumber}`);

      const lockLogs = await this.ethChain.getLockLogs(this.lastHandledBlockHeight + 1, endBlockNumber);
      for (const log of lockLogs) {
        await this.onLockLogs(log.log, log.parsedLog);
      }

      const UnlockLogs = await this.ethChain.getUnlockLogs(this.lastHandledBlockHeight + 1, endBlockNumber);
      for (const log of UnlockLogs) {
        await this.onUnlockLogs(log.log, log.parsedLog);
      }

      const endBlock = await this.ethChain.getBlock(endBlockNumber);
      await this.confirmEthLocks(endBlockNumber, confirmNumber);
      await this.setLastHandledBlock(endBlockNumber, endBlock.hash);
      if (endBlockNumber == currentBlockHeight) {
        break;
      }
    }
  }

  watchNewBlock(): void {
    void (async () => {
      await this.init();
      this.ethChain.watchNewBlock(this.lastHandledBlockHeight, async (newBlock: ethers.providers.Block) => {
        await retryPromise(
          async () => {
            await this.onBlock(newBlock);
            const currentBlockHeight = await this.ethChain.getCurrentBlockNumber();
            BridgeMetricSingleton.getInstance(this.role).setBlockHeightMetrics(
              'eth',
              newBlock.number,
              currentBlockHeight,
            );
          },
          {
            onRejectedInterval: 3000,
            maxRetryTimes: MAX_RETRY_TIMES,
            onRejected: (e: Error) => {
              logger.error(`Eth watchNewBlock blockHeight:${newBlock} error:${e.message}`);
            },
          },
        );
      });
    })();
  }

  isForked(confirmNumber: number, block: ethers.providers.Block): boolean {
    return (
      confirmNumber !== 0 &&
      this.lastHandledBlockHeight === block.number - 1 &&
      this.lastHandledBlockHash !== '' &&
      block.parentHash !== this.lastHandledBlockHash
    );
  }

  async onBlock(block: ethers.providers.Block): Promise<void> {
    const confirmNumber = ForceBridgeCore.config.eth.confirmNumber;
    if (this.isForked(confirmNumber, block)) {
      BridgeMetricSingleton.getInstance(this.role).setForkEventHeightMetrics('eth', this.lastHandledBlockHeight);
      logger.warn(
        `EthHandler onBlock blockHeight:${block.number} parentHash:${block.parentHash} != lastHandledBlockHash:${
          this.lastHandledBlockHash
        } fork occur removeUnconfirmedLock events from:${block.number - confirmNumber}`,
      );
      const confirmedBlockHeight = block.number - confirmNumber;
      await this.ethDb.removeUnconfirmedLocks(confirmedBlockHeight);
      await this.feeDb.removeForkedWithdrawFee(confirmedBlockHeight);
      if (this.role !== 'collector') await this.ethDb.removeUnconfirmedUnlocks(confirmedBlockHeight);

      const lockLogs = await this.ethChain.getLockLogs(confirmedBlockHeight + 1, block.number);
      if (
        await this.ethChain.isLogForked(
          lockLogs.map((log) => {
            return log.log;
          }),
        )
      ) {
        throw new Error(`lock log fork occured when reorg block ${block.number}`);
      }
      for (const log of lockLogs) {
        await this.onLockLogs(log.log, log.parsedLog);
      }

      const unlockLogs = await this.ethChain.getUnlockLogs(confirmedBlockHeight + 1, block.number);
      if (
        await this.ethChain.isLogForked(
          unlockLogs.map((log) => {
            return log.log;
          }),
        )
      ) {
        throw new Error(`unlock log fork occured when reorg block ${block.number}`);
      }
      for (const log of unlockLogs) {
        await this.onUnlockLogs(log.log, log.parsedLog);
      }
    }

    // onLockLogs
    const lockLogs = await this.ethChain.getLockLogsByBlockHash(block.hash);
    for (const log of lockLogs) {
      await this.onLockLogs(log.log, log.parsedLog);
    }

    // onUnlockLogs
    const unlockLogs = await this.ethChain.getUnlockLogsByBlockHash(block.hash);
    for (const log of unlockLogs) {
      await this.onUnlockLogs(log.log, log.parsedLog);
    }

    await this.confirmEthLocks(block.number, confirmNumber);
    await this.setLastHandledBlock(block.number, block.hash);
    logger.info(`EthHandler onBlock blockHeight:${block.number} blockHash:${block.hash}`);
  }

  async confirmEthLocks(currentBlockHeight: number, confirmNumber: number): Promise<void> {
    const confirmedBlockHeight = currentBlockHeight - confirmNumber;
    const unConfirmedLocks = await this.ethDb.getUnconfirmedLocks();
    if (unConfirmedLocks.length === 0) {
      return;
    }

    const updateConfirmNumberRecords = unConfirmedLocks
      .filter((record) => record.blockNumber > confirmedBlockHeight)
      .map((record) => {
        return { txHash: record.txHash, confirmedNumber: currentBlockHeight - record.blockNumber };
      });
    if (updateConfirmNumberRecords.length !== 0) {
      await this.ethDb.updateLockConfirmNumber(updateConfirmNumberRecords);
    }

    const confirmedRecords = unConfirmedLocks.filter((record) => record.blockNumber <= confirmedBlockHeight);
    if (confirmedRecords.length === 0) {
      return;
    }
    const confirmedTxHashes = confirmedRecords.map((lock) => {
      return lock.txHash;
    });

    logger.info(`EhtHandler confirmEthLocks updateLockConfirmStatus txHashes:${confirmedTxHashes.join(', ')}`);
    await this.ethDb.updateLockConfirmStatus(confirmedTxHashes);

    if (this.role === 'collector') {
      const mintRecords = confirmedRecords.map((lockRecord) => {
        if (BigInt(lockRecord.amount) <= BigInt(lockRecord.bridgeFee))
          throw new Error('Unexpected error: lock amount less than bridge fee');
        return {
          id: lockRecord.txHash,
          lockBlockHeight: lockRecord.blockNumber,
          chain: ChainType.ETH,
          amount: (BigInt(lockRecord.amount) - BigInt(lockRecord.bridgeFee)).toString(),
          asset: lockRecord.token,
          recipientLockscript: lockRecord.recipient,
          sudtExtraData: lockRecord.sudtExtraData,
        };
      });
      await this.ethDb.createCkbMint(mintRecords);
      mintRecords.forEach((mintRecord) => {
        logger.info(
          `EthHandler onBlock blockHeight:${currentBlockHeight} save CkbMint successful for eth tx ${mintRecord.id}.`,
        );
      });
    }
  }

  async onLockLogs(log: Log, parsedLog: ParsedLog): Promise<void> {
    for (let i = 1; i <= MAX_RETRY_TIMES; i++) {
      try {
        const txHash = log.transactionHash;
        const { token, sudtExtraData, sender } = parsedLog.args;
        const recipient = uint8ArrayToString(fromHexString(parsedLog.args.recipientLockscript));
        logger.info(
          `EthHandler watchLockEvents receiveLog blockHeight:${log.blockNumber} blockHash:${log.blockHash} txHash:${
            log.transactionHash
          } amount:${parsedLog.args.lockedAmount.toString()} asset:${parsedLog.args.token} recipientLockscript:${
            parsedLog.args.recipientLockscript
          } sudtExtraData:${parsedLog.args.sudtExtraData} sender:${parsedLog.args.sender}`,
        );
        logger.debug('EthHandler watchLockEvents eth lockEvtLog:', { log, parsedLog });
        const amount = parsedLog.args.lockedAmount.toString();
        const asset = new EthAsset(parsedLog.args.token);
        if (!asset.inWhiteList() || BigInt(amount) < BigInt(asset.getMinimalAmount())) return;

        const bridgeFee = this.role === 'collector' ? asset.getBridgeFee('in') : '0';
        await this.ethDb.createEthLock([
          {
            txHash: txHash,
            amount: amount,
            bridgeFee: bridgeFee,
            token: token,
            recipient: recipient,
            sudtExtraData: sudtExtraData,
            blockNumber: log.blockNumber,
            blockHash: log.blockHash,
            sender: sender,
          },
        ]);
        BridgeMetricSingleton.getInstance(this.role).addBridgeTxMetrics('eth_lock', 'success');
        BridgeMetricSingleton.getInstance(this.role).addBridgeTokenMetrics('eth_lock', [
          {
            amount: Number(amount),
            token: token,
          },
        ]);
        logger.info(`EthHandler watchLockEvents save EthLock successful for eth tx ${log.transactionHash}.`);
        if (this.role !== 'collector') {
          await this.ethDb.updateBridgeInRecord(txHash, amount, token, recipient, sudtExtraData);
          logger.info(
            `Watcher update bridge in record successful while handle lock log for eth tx ${log.transactionHash}.`,
          );
        }
        break;
      } catch (e) {
        logger.error(`EthHandler watchLockEvents error: ${e}`);
        if (i == MAX_RETRY_TIMES) {
          throw e;
        }
        await asyncSleep(3000);
      }
    }
  }

  async onUnlockLogs(log: Log, parsedLog: ParsedLog): Promise<void> {
    for (let i = 1; i <= MAX_RETRY_TIMES; i++) {
      try {
        const amount = parsedLog.args.receivedAmount.toString();
        const { ckbTxHash, recipient, token } = parsedLog.args;
        const unlockTxHash = log.transactionHash;
        logger.info(
          `EthHandler watchUnlockEvents receiveLog blockHeight:${log.blockNumber} blockHash:${log.blockHash} txHash:${unlockTxHash} amount:${amount} asset:${parsedLog.args.token} recipient:${parsedLog.args.recipient} ckbTxHash:${ckbTxHash} sender:${parsedLog.args.sender}`,
        );
        logger.debug('EthHandler watchUnlockEvents eth unlockLog:', { log, parsedLog });
        if (ckbTxHash === WithdrawBridgeFeeTopic) {
          await this.feeDb.createWithdrawedBridgeFee([
            {
              txHash: unlockTxHash,
              blockNumber: log.blockNumber,
              recipient: recipient,
              chain: ChainType.ETH,
              asset: token,
              amount: amount,
            },
          ]);
          return;
        }
        if (this.role === 'collector') return;
        await this.ethDb.createEthUnlock([
          {
            ckbTxHash: ckbTxHash,
            amount: amount,
            asset: token,
            recipientAddress: recipient,
            blockNumber: log.blockNumber,
            ethTxHash: unlockTxHash,
            status: 'success',
          },
        ]);
        await this.ethDb.updateBurnBridgeFee(ckbTxHash, amount);
        BridgeMetricSingleton.getInstance(this.role).addBridgeTokenMetrics('eth_unlock', [
          {
            amount: Number(amount),
            token: parsedLog.args.token,
          },
        ]);
        break;
      } catch (e) {
        logger.error(`EthHandler watchUnlockEvents error: ${e}`);
        if (i == MAX_RETRY_TIMES) {
          throw e;
        }
        await asyncSleep(3000);
      }
    }
  }

  // // listen ETH chain and handle the new lock events
  // watchLockEvents(): void {
  //   this.ethChain.watchLockEvents(this.lastHandledBlockHeight, async (log, parsedLog) => {
  //     await this.onLockLogs(log, parsedLog);
  //   });
  // }
  //
  // watchUnlockEvents(): void {
  //   let unlockHash = '';
  //   this.ethChain.watchUnlockEvents(this.lastHandledBlockHeight, async (log, parsedLog) => {
  //     await this.onUnlockLogs(log, parsedLog);
  //     if (log.transactionHash != unlockHash) {
  //       unlockHash = log.transactionHash;
  //       BridgeMetricSingleton.getInstance(this.role).addBridgeTxMetrics('eth_unlock', 'success');
  //     }
  //   });
  // }

  async getUnlockRecords(status: EthUnlockStatus): Promise<EthUnlock[]> {
    return this.ethDb.getEthUnlockRecordsToUnlock(status);
  }

  // watch the eth_unlock table and handle the new unlock events
  // send tx according to the data
  handleUnlockRecords(): void {
    if (this.role !== 'collector') {
      return;
    }

    this.handlePendingUnlockRecords().then(
      () => {
        this.handleTodoUnlockRecords();
      },
      (err) => {
        logger.error(`handlePendingUnlockRecords error:${err.message}`);
      },
    );
  }

  async handlePendingUnlockRecords(): Promise<void> {
    for (;;) {
      try {
        const records = await this.getUnlockRecords('pending');
        const pendingTx = await this.ethChain.getMultiSigMgr().getPendingTx({ chain: 'eth' });
        if (pendingTx === undefined && records.length !== 0) {
          //pendingTx has already completed
          records.map((record) => {
            record.status = 'success';
          });
          const unlockTxHashes = records.map((record) => {
            return record.ckbTxHash;
          });
          await this.ethDb.saveEthUnlock(records);
          logger.info(`EthHandler handlePendingUnlockRecords set Record to complete ckbTxHashes:${unlockTxHashes}`);
          break;
        }
        if (records.length !== 0) {
          await this.doHandleUnlockRecords(records);
          break;
        }
        if (pendingTx !== undefined) {
          logger.info(`EthHandler handlePendingUnlockRecords pendingTx:${JSON.stringify(pendingTx, undefined, 2)}`);
          await this.doHandleUnlockRecords(
            (pendingTx.payload as ethCollectSignaturesPayload).unlockRecords.map((ethUnlock) => {
              return {
                ckbTxHash: ethUnlock.ckbTxHash,
                asset: ethUnlock.token,
                recipientAddress: ethUnlock.recipient,
                amount: BigNumber.from(ethUnlock.amount).toString(),
                ethTxHash: '',
                status: 'pending',
                message: '',
              };
            }),
          );
        }
        break;
      } catch (e) {
        logger.error(`doHandlePendingUnlockRecords error:${e.message} stack:${e.stack}`);
        await asyncSleep(3000);
      }
    }
  }

  handleTodoUnlockRecords(): void {
    foreverPromise(
      async () => {
        await asyncSleep(15000);
        logger.debug('EthHandler watchUnlockEvents get new unlock events and send tx');
        const records = await this.getUnlockRecords('todo');
        if (records.length === 0 || this.waitForBatch(records)) {
          logger.info('wait for batch');
          return;
        }
        logger.info(`EthHandler watchUnlockEvents unlock records: ${records}`);
        await this.doHandleUnlockRecords(records);
      },
      {
        onRejectedInterval: 0,
        onResolvedInterval: 0,
        onRejected: (e: Error) => {
          logger.error(`ETH handleTodoUnlockRecords error:${e.message}`);
        },
      },
    );
  }

  async doHandleUnlockRecords(records: IEthUnlock[]): Promise<void> {
    if (records.length === 0) {
      return;
    }

    const unlockTxHashes = records
      .map((unlockRecord) => {
        return unlockRecord.ckbTxHash;
      })
      .join(', ');
    logger.info(
      `EthHandler doHandleUnlockRecords start process unlock Record, ckbTxHashes:${unlockTxHashes} num:${records.length}`,
    );

    for (;;) {
      try {
        // write db first, avoid send tx success and fail to write db
        records.map((r) => {
          r.status = 'pending';
        });
        await this.ethDb.saveEthUnlock(records);
        const txRes = await this.ethChain.sendUnlockTxs(records);
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
          BridgeMetricSingleton.getInstance(this.role).addBridgeTxMetrics('eth_unlock', 'failed');
          logger.error(
            `EthHandler doHandleUnlockRecords ckbTxHashes:${unlockTxHashes}  sendUnlockTxs error:${txRes as Error}`,
          );
          break;
        }

        records.map((r) => {
          r.status = 'pending';
          r.ethTxHash = txRes.hash;
        });
        await this.ethDb.saveEthUnlock(records);
        logger.debug('sendUnlockTxs res', txRes);
        const receipt = await txRes.wait();
        logger.info(`EthHandler doHandleUnlockRecords sendUnlockTxs receipt:${JSON.stringify(receipt.logs)}`);
        if (receipt.status === 1) {
          records.map((r) => {
            r.status = 'success';
          });
          const unlockTokens = records.map((r) => {
            const tokenInfo: txTokenInfo = {
              amount: Number(r.amount),
              token: r.asset,
            };
            return tokenInfo;
          });
          BridgeMetricSingleton.getInstance(this.role).addBridgeTokenMetrics('eth_unlock', unlockTokens);
          BridgeMetricSingleton.getInstance(this.role).addBridgeTxMetrics('eth_unlock', 'success');
        } else {
          records.map((r) => {
            r.status = 'error';
            r.message = 'unlock tx failed';
          });
          BridgeMetricSingleton.getInstance(this.role).addBridgeTxMetrics('eth_unlock', 'failed');
          logger.error(
            `EthHandler doHandleUnlockRecords ckbTxHashes:${unlockTxHashes} unlock execute failed:${receipt}`,
          );
        }
        break;
      } catch (e) {
        logger.error(`EthHandler doHandleUnlockRecords ckbTxHashes:${unlockTxHashes} error:${e.stack}`);
        await asyncSleep(5000);
      }
    }
    for (;;) {
      try {
        await this.ethDb.saveEthUnlock(records);
        logger.info(`EthHandler doHandleUnlockRecords process unlock Record completed ckbTxHashes:${unlockTxHashes}`);
        break;
      } catch (e) {
        logger.error(
          `EthHandler doHandleUnlockRecords db.saveEthUnlock ckbTxHashes:${unlockTxHashes} error:${e.stack}`,
        );
        await asyncSleep(3000);
      }
    }
  }

  waitForBatch(records: EthUnlock[]): boolean {
    if (ForceBridgeCore.config.common.network === 'testnet') return false;
    const now = new Date();
    const maxWaitTime = ForceBridgeCore.config.eth.batchUnlock.maxWaitTime;
    if (
      records.find((record) => {
        return new Date(record.createdAt).getMilliseconds() + maxWaitTime <= now.getMilliseconds();
      })
    )
      return false;
    return records.length < ForceBridgeCore.config.eth.batchUnlock.batchNumber;
  }

  start(): void {
    this.watchNewBlock();

    this.handleUnlockRecords();
    logger.info('eth handler started  🚀');
  }
}
