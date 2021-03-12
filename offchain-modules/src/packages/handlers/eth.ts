import { EthDb } from '../db';
import { logger } from '../utils/logger';
import { asyncSleep } from '../utils';
import { abi } from '../xchain/eth/abi/ForceBridge.json';
import { ForceBridgeCore } from '../core';
import { ethers } from 'ethers';
import { CkbMint, EthUnlock } from '@force-bridge/db/model';
import { ChainType } from '@force-bridge/ckb/model/asset';
import { getRepository } from 'typeorm';
import { EthUnlockStatus } from '@force-bridge/db/entity/EthUnlock';
import { EthChain } from '@force-bridge/xchain/eth';

export class EthHandler {
  constructor(private db: EthDb, private ethChain: EthChain) {}

  // listen ETH chain and handle the new lock events
  async watchLockEvents() {
    const latestHeight = await this.db.getLatestHeight();
    logger.debug('latestHeight: ', latestHeight);
    this.ethChain.watchUnlockRecords(latestHeight, async (log, parsedLog) => {
      logger.debug('log:', { log, parsedLog });
      await this.db.createCkbMint([
        {
          id: log.transactionHash,
          chain: ChainType.ETH,
          amount: parsedLog.args.lockedAmount.toHexString(),
          asset: parsedLog.args.token,
          recipientLockscript: parsedLog.args.recipientLockscript,
          sudtExtraData: parsedLog.args.sudtExtraData,
        },
      ]);
      await this.db.createEthLock([
        {
          txHash: log.transactionHash,
          amount: parsedLog.args.lockedAmount.toHexString(),
          token: parsedLog.args.token,
          recipientLockscript: parsedLog.args.recipientLockscript,
          sudtExtraData: parsedLog.args.sudtExtraData,
          blockNumber: log.blockNumber,
          blockHash: log.blockHash,
          sender: parsedLog.args.sender,
        },
      ]);
      logger.debug(`save CkbMint and EthLock successful for eth tx ${log.transactionHash}.`);
    });
  }

  async getUnlockRecords(status: EthUnlockStatus): Promise<EthUnlock[]> {
    return await this.db.getEthUnlockRecordsToUnlock(status);
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
