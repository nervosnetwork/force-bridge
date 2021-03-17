import { logger } from '../utils/logger';
import { asyncSleep } from '../utils';
import { EosDb } from '@force-bridge/db/eos';
import { EosChain, EosLockRecord } from '@force-bridge/xchain/eos/eosChain';
import { ChainType } from '@force-bridge/ckb/model/asset';
import { EosUnlock, EosUnlockStatus } from '@force-bridge/db/entity/EosUnlock';
import { TransactResult } from 'eosjs/dist/eosjs-api-interfaces';
import { PushTransactionArgs } from 'eosjs/dist/eosjs-rpc-interfaces';

export class EosHandler {
  constructor(private db: EosDb, private eosChain: EosChain) {}

  async getUnlockRecords(status: EosUnlockStatus): Promise<EosUnlock[]> {
    return this.db.getEosUnlockRecordsToUnlock(status);
  }

  async sendUnlockTx(record: EosUnlock): Promise<TransactResult | PushTransactionArgs> {
    return this.eosChain.transferTo(record.recipientAddress, record.amount, '');
  }

  async watchLockEvents() {
    let latestHeight = await this.db.getLatestHeight();
    if (latestHeight === 0) {
      const curBlockInfo = await this.eosChain.getCurrentBlockInfo();
      latestHeight = curBlockInfo.head_block_num;
    }
    await this.eosChain.watchLockRecords(latestHeight, async (record: EosLockRecord) => {
      const fragments = record.Memo.split('#');
      const recipientLockscript = fragments[0] ? fragments[0] : '';
      const sudtExtraData = fragments[1] ? fragments[1] : '';
      try {
        await this.db.createCkbMint([
          {
            id: record.TxHash,
            chain: ChainType.EOS,
            amount: record.Amount,
            asset: record.Asset,
            recipientLockscript: recipientLockscript,
            sudtExtraData: sudtExtraData,
          },
        ]);
        await this.db.createEosLock([
          {
            txHash: record.TxHash,
            amount: record.Amount,
            token: record.Asset,
            sender: record.From,
            recipientLockscript: recipientLockscript,
            sudtExtraData: sudtExtraData,
            blockHash: record.BlockHash,
            blockNumber: record.BlockNumber,
          },
        ]);
        logger.info(
          `process CkbMint and EosLock successful for eos tx:${record.TxHash} from:${record.From} amount:${record.Amount}.`,
        );
      } catch (e) {
        logger.error(
          `process eosLock event failed.tx:${record.TxHash} from:${record.From} amount:${record.Amount} error:${e}.`,
        );
      }
    });
  }

  async watchUnlockEvents() {
    while (true) {
      const todoRecords = await this.getUnlockRecords('todo');
      if (todoRecords.length === 0) {
        await asyncSleep(15000);
        continue;
      }
      await this.processUnLockEvents(todoRecords);
    }
  }

  async processUnLockEvents(records: EosUnlock[]) {
    for (const record of records) {
      try {
        record.status = 'pending';
        await this.db.saveEosUnlock([record]);
        const txResult = await this.sendUnlockTx(record);
        if ('transaction_id' in txResult) {
          record.status = 'success';
          record.eosTxHash = txResult.transaction_id;
          logger.debug(
            `EosUnlock process success ckbTxHash:${record.ckbTxHash} receiver:${record.recipientAddress} eosTxhash:${record.eosTxHash}`,
          );
        } else {
          record.status = 'error';
          logger.error(
            `Eos precess unlockTx failed. ckbTxHash:${record.ckbTxHash} receiver:${record.recipientAddress} txResult:${txResult}`,
          );
        }
        await this.db.saveEosUnlock([record]);
      } catch (e) {
        record.status = 'error';
        await this.db.saveEosUnlock([record]);
        logger.error(
          `EosUnlock process failed ckbTxHash:${record.ckbTxHash} receiver:${record.recipientAddress} error:${e}`,
        );
      }
    }
  }

  start() {
    this.watchLockEvents();
    this.watchUnlockEvents();
    logger.info('eos handler started  🚀');
  }
}
