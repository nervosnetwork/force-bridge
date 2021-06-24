import { Amount } from '@lay2/pw-core';
import { ethers } from 'ethers';
import { ChainType, EthAsset } from '../ckb/model/asset';
import { forceBridgeRole } from '../config';
import { ForceBridgeCore } from '../core';
import { EthDb, KVDb } from '../db';
import { EthUnlockStatus } from '../db/entity/EthUnlock';
import { EthUnlock } from '../db/model';
import { BridgeMetricSingleton, txTokenInfo } from '../monitor/bridge-metric';
import { asyncSleep, foreverPromise, fromHexString, retryPromise, uint8ArrayToString } from '../utils';
import { logger } from '../utils/logger';
import { EthChain, Log, ParsedLog } from '../xchain/eth';

const MAX_RETRY_TIMES = 3;
const lastHandleEthBlockKey = 'lastHandleEthBlock';

export class EthHandler {
  private lastHandledBlockHeight: number;
  private lastHandledBlockHash: string;

  constructor(private db: EthDb, private kvDb: KVDb, private ethChain: EthChain, private role: forceBridgeRole) {}

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
      logger.warn(
        `EthHandler init nextBlock blockHeight:${nextBlock.number} parentHash:${
          nextBlock.parentHash
        } != lastHandledBlockHash:${this.lastHandledBlockHash} fork occur removeUnconfirmedLock events from:${
          nextBlock.number - confirmNumber
        }`,
      );
      const confirmedBlockHeight = nextBlock.number - confirmNumber;
      const confirmedBlock = await this.ethChain.getBlock(currentBlockHeight);
      await this.db.removeUnconfirmedLocks(confirmedBlockHeight);
      await this.setLastHandledBlock(confirmedBlockHeight, confirmedBlock.hash);
    }

    for (;;) {
      const endBlockNumber =
        this.lastHandledBlockHeight + getLogBatchSize > currentBlockHeight
          ? currentBlockHeight
          : this.lastHandledBlockHeight + getLogBatchSize;

      logger.info(`EthHandler init getLogs from:${this.lastHandledBlockHeight} to:${endBlockNumber}`);

      const logs = await this.ethChain.getLockLogs(this.lastHandledBlockHeight + 1, endBlockNumber);
      for (const log of logs) {
        await this.onLockLogs(log.log, log.parsedLog);
      }

      if (this.role === 'watcher') {
        const logs = await this.ethChain.getUnlockLogs(this.lastHandledBlockHeight + 1, endBlockNumber);
        for (const log of logs) {
          await this.onUnlockLogs(log.log, log.parsedLog);
        }
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
            onRejected: (e: Error) => logger.error(`Eth watchNewBlock blockHeight:${newBlock} error:${e.message}`),
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
      logger.warn(
        `EthHandler onBlock blockHeight:${block.number} parentHash:${block.parentHash} != lastHandledBlockHash:${
          this.lastHandledBlockHash
        } fork occur removeUnconfirmedLock events from:${block.number - confirmNumber}`,
      );
      const confirmedBlockHeight = block.number - confirmNumber;
      await this.db.removeUnconfirmedLocks(confirmedBlockHeight);
      const logs = await this.ethChain.getLockLogs(confirmedBlockHeight + 1, block.number);

      if (
        await this.ethChain.isLogForked(
          logs.map((log) => {
            return log.log;
          }),
        )
      ) {
        throw new Error(`log fork occured when reorg block ${block.number}`);
      }
      for (const log of logs) {
        await this.onLockLogs(log.log, log.parsedLog);
      }
    }

    // onLockLogs
    const lockLogs = await this.ethChain.getLockLogs(block.number, block.number);
    for (const log of lockLogs) {
      await this.onLockLogs(log.log, log.parsedLog);
    }

    // onUnlockLogs
    if (this.role !== 'collector') {
      const unlockLogs = await this.ethChain.getUnlockLogs(block.number, block.number);
      for (const log of unlockLogs) {
        await this.onUnlockLogs(log.log, log.parsedLog);
      }
    }

    await this.confirmEthLocks(block.number, confirmNumber);
    await this.setLastHandledBlock(block.number, block.hash);
    logger.info(`EthHandler onBlock blockHeight:${block.number} blockHash:${block.hash}`);
  }

  async confirmEthLocks(currentBlockHeight: number, confirmNumber: number): Promise<void> {
    const confirmedBlockHeight = currentBlockHeight - confirmNumber;
    const unConfirmedLocks = await this.db.getUnconfirmedLocks();
    if (unConfirmedLocks.length === 0) {
      return;
    }

    const updateConfirmNumberRecords = unConfirmedLocks
      .filter((record) => record.blockNumber > confirmedBlockHeight)
      .map((record) => {
        return { txHash: record.txHash, confirmedNumber: currentBlockHeight - record.blockNumber };
      });
    if (updateConfirmNumberRecords.length !== 0) {
      await this.db.updateLockConfirmNumber(updateConfirmNumberRecords);
    }

    const confirmedRecords = unConfirmedLocks.filter((record) => record.blockNumber <= confirmedBlockHeight);
    const confirmedTxHashes = confirmedRecords.map((lock) => {
      return lock.txHash;
    });
    if (confirmedRecords.length === 0) {
      return;
    }

    logger.info(`EhtHandler confirmEthLocks updateLockConfirmStatus txHashes:${confirmedTxHashes.join(', ')}`);
    await this.db.updateLockConfirmStatus(confirmedTxHashes);

    if (this.role === 'collector') {
      const mintRecords = confirmedRecords.map((lockRecord) => {
        return {
          id: lockRecord.txHash,
          chain: ChainType.ETH,
          amount: new Amount(lockRecord.amount, 0).sub(new Amount(lockRecord.bridgeFee, 0)).toString(0),
          asset: lockRecord.token,
          recipientLockscript: lockRecord.recipient,
          sudtExtraData: lockRecord.sudtExtraData,
        };
      });
      await this.db.createCkbMint(mintRecords);
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
        if (!asset.inWhiteList() || new Amount(amount, 0).lt(new Amount(asset.getMinimalAmount(), 0))) return;

        const bridgeFee = this.role === 'collector' ? asset.getBridgeFee('in') : '0';
        await this.db.createEthLock([
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
        if (this.role === 'watcher') {
          await this.db.updateBridgeInRecord(txHash, amount, token, recipient, sudtExtraData);
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
        const ckbTxHash = parsedLog.args.ckbTxHash;
        const unlockTxHash = log.transactionHash;
        logger.info(
          `EthHandler watchUnlockEvents receiveLog blockHeight:${log.blockNumber} blockHash:${log.blockHash} txHash:${unlockTxHash} amount:${amount} asset:${parsedLog.args.token} recipient:${parsedLog.args.recipient} ckbTxHash:${ckbTxHash} sender:${parsedLog.args.sender}`,
        );
        logger.info('EthHandler watchUnlockEvents eth unlockLog:', { log, parsedLog });
        await this.db.createEthUnlock([
          {
            ckbTxHash: ckbTxHash,
            amount: amount,
            asset: parsedLog.args.token,
            recipientAddress: parsedLog.args.recipient,
            ethTxHash: unlockTxHash,
            status: 'success',
          },
        ]);
        await this.db.updateBurnBridgeFee(ckbTxHash, amount);
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

  // listen ETH chain and handle the new lock events
  watchLockEvents(): void {
    this.ethChain.watchLockEvents(this.lastHandledBlockHeight, async (log, parsedLog) => {
      await this.onLockLogs(log, parsedLog);
    });
  }

  watchUnlockEvents(): void {
    let unlockHash = '';
    this.ethChain.watchUnlockEvents(this.lastHandledBlockHeight, async (log, parsedLog) => {
      await this.onUnlockLogs(log, parsedLog);
      if (log.transactionHash != unlockHash) {
        unlockHash = log.transactionHash;
        BridgeMetricSingleton.getInstance(this.role).addBridgeTxMetrics('eth_unlock', 'success');
      }
    });
  }

  async getUnlockRecords(status: EthUnlockStatus): Promise<EthUnlock[]> {
    return this.db.getEthUnlockRecordsToUnlock(status);
  }

  // watch the eth_unlock table and handle the new unlock events
  // send tx according to the data
  handleUnlockRecords(): void {
    if (this.role !== 'collector') {
      return;
    }
    // todo: get and handle pending and error records
    foreverPromise(
      async () => {
        await asyncSleep(15000);
        logger.debug('EthHandler watchUnlockEvents get new unlock events and send tx');
        const records = await this.getUnlockRecords('todo');
        if (records.length === 0 || this.waitForBatch(records)) {
          logger.info('wait for batch');
          return;
        }
        logger.info('EthHandler watchUnlockEvents unlock records', records);

        const unlockTxHashes = records
          .map((unlockRecord) => {
            return unlockRecord.ckbTxHash;
          })
          .join(', ');
        logger.info(
          `EthHandler watchUnlockEvents start process unlock Record, ckbTxHashes:${unlockTxHashes} num:${records.length}`,
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
          logger.info(`EthHandler watchUnlockEvents sendUnlockTxs receipt:${JSON.stringify(receipt.logs, null, 2)}`);
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
            logger.error('EthHandler watchUnlockEvents unlock execute failed:', receipt);
          }
          await this.db.saveEthUnlock(records);
          logger.info('EthHandler watchUnlockEvents process unlock Record completed');
        } catch (e) {
          records.map((r) => {
            r.status = 'error';
            r.message = e.message;
          });
          await this.db.saveEthUnlock(records);

          logger.error(`EthHandler watchUnlockEvents error:${e.toString()}, ${e.message}`);
        }
      },
      {
        onRejectedInterval: 0,
        onResolvedInterval: 0,
      },
    );
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
