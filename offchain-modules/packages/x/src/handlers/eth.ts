import { ethers } from 'ethers';
import { ChainType } from '../ckb/model/asset';
import { forceBridgeRole } from '../config';
import { ForceBridgeCore } from '../core';
import { EthDb, KVDb } from '../db';
import { EthUnlockStatus } from '../db/entity/EthUnlock';
import { EthUnlock } from '../db/model';
import { asyncSleep, fromHexString, uint8ArrayToString } from '../utils';
import { logger } from '../utils/logger';
import { EthChain } from '../xchain/eth';

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

  async init() {
    const currentBlockHeight = await this.ethChain.getCurrentBlockNumber();
    const lastHandledBlock = await this.getLastHandledBlock();
    if (lastHandledBlock.blockNumber === 0) {
      const currentBlock = await this.ethChain.getBlock(currentBlockHeight);
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
    const confirmNumber = ForceBridgeCore.config.eth.confirmNumber;
    const getLogBatchSize = 100;

    for (;;) {
      const endBlockNumber =
        this.lastHandledBlockHeight + getLogBatchSize > currentBlockHeight
          ? currentBlockHeight
          : this.lastHandledBlockHeight + getLogBatchSize;

      logger.info(`EthHandler init getLogs from:${this.lastHandledBlockHeight} to:${endBlockNumber}`);

      const logs = await this.ethChain.getLogs(this.lastHandledBlockHeight + 1, endBlockNumber);
      for (const log of logs) {
        await this.onLogs(log.log, log.parsedLog);
      }
      const endBlock = await this.ethChain.getBlock(endBlockNumber);

      await this.confirmEthLocks(endBlockNumber, confirmNumber);
      await this.setLastHandledBlock(endBlockNumber, endBlock.hash);
      if (endBlockNumber == currentBlockHeight) {
        break;
      }
    }
  }

  async watchNewBlock() {
    await this.ethChain.watchNewBlock(this.lastHandledBlockHeight, async (newBlock: ethers.providers.Block) => {
      await this.onBlock(newBlock);
    });
  }

  async onBlock(block: ethers.providers.Block) {
    try {
      const confirmNumber = ForceBridgeCore.config.eth.confirmNumber;
      if (
        confirmNumber !== 0 &&
        this.lastHandledBlockHeight === block.number - 1 &&
        this.lastHandledBlockHash !== '' &&
        block.parentHash !== this.lastHandledBlockHash
      ) {
        logger.warn(
          `EthHandler onBlock blockHeight:${block.number} parentHash:${block.parentHash} != lastHandledBlockHash:${
            this.lastHandledBlockHash
          } fork occur removeUnconfirmedLock events from:${block.number - confirmNumber}`,
        );
        const confirmedBlockHeight = block.number - confirmNumber;
        await this.db.removeUnconfirmedLocks(confirmedBlockHeight);
        const logs = await this.ethChain.getLogs(confirmedBlockHeight + 1, block.number);
        for (const log of logs) {
          await this.onLogs(log.log, log.parsedLog);
        }
      }

      await this.confirmEthLocks(block.number, confirmNumber);
      await this.setLastHandledBlock(block.number, block.hash);
      logger.info(`EthHandler onBlock blockHeight:${block.number} blockHash:${block.hash}`);
    } catch (e) {
      logger.error(
        `EthHandler onBlock error, blockHeight:${block.number} blockHash:${block.hash} error:${e.toString()}`,
      );
    }
  }

  async confirmEthLocks(currentBlockHeight: number, confirmNumber: number) {
    const confirmedBlockHeight = currentBlockHeight - confirmNumber;
    const confirmedLocks = await this.db.getUnconfirmedLocksToConfirm(confirmedBlockHeight);
    if (confirmedLocks.length === 0) {
      return;
    }
    const confirmedTxHashes = confirmedLocks.map((lock) => {
      return lock.txHash;
    });

    logger.info(`EhtHandler confirmEthLocks updateLockConfirmStatus txHashes:${confirmedTxHashes.join(', ')}`);
    await this.db.updateLockConfirmStatus(confirmedTxHashes);

    if (this.role !== 'collector') {
      return;
    }
    const mintRecords = confirmedLocks.map((lockRecord) => {
      return {
        id: lockRecord.txHash,
        chain: ChainType.ETH,
        amount: lockRecord.amount,
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

  async onLogs(log, parsedLog) {
    try {
      logger.info(
        `EthHandler watchLockEvents receiveLog blockHeight:${log.blockNumber} blockHash:${log.blockHash} txHash:${
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
      logger.info(`EthHandler watchLockEvents save EthLock successful for eth tx ${log.transactionHash}.`);
    } catch (e) {
      logger.error(`EthHandler watchLockEvents error: ${e}`);
      await asyncSleep(3000);
    }
  }

  // listen ETH chain and handle the new lock events
  async watchLockEvents() {
    await this.ethChain.watchLockEvents(this.lastHandledBlockHeight, async (log, parsedLog) => {
      await this.onLogs(log, parsedLog);
    });
  }

  async getUnlockRecords(status: EthUnlockStatus): Promise<EthUnlock[]> {
    return this.db.getEthUnlockRecordsToUnlock(status);
  }

  // watch the eth_unlock table and handle the new unlock events
  // send tx according to the data
  async watchUnlockEvents() {
    if (this.role !== 'collector') {
      return;
    }
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
            r.message = 'unlock tx failed';
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

  async start() {
    await this.init();
    this.watchNewBlock();
    this.watchLockEvents();
    this.watchUnlockEvents();
    logger.info('eth handler started  🚀');
  }
}
