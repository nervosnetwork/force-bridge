import { logger } from '../utils/logger';
import { asyncSleep } from '../utils';
import { EosDb } from '@force-bridge/db/eos';
import { EosChain } from '@force-bridge/xchain/eos/eosChain';
import { ChainType } from '@force-bridge/ckb/model/asset';
import { EosUnlock, EosUnlockStatus } from '@force-bridge/db/entity/EosUnlock';
import { TransactResult } from 'eosjs/dist/eosjs-api-interfaces';
import { GetBlockResult, PushTransactionArgs } from 'eosjs/dist/eosjs-rpc-interfaces';
import { EosConfig } from '@force-bridge/config';
import { parseAssetAmount } from '@force-bridge/xchain/eos/utils';
import { JsSignatureProvider } from 'eosjs/dist/eosjs-jssig';

const EosDecimal = 4;
const EosTokenAccount = 'eosio.token';
const EosTokenTransferActionName = 'transfer';
const EosTransactionStatus = 'executed';

export class EosLockEvent {
  TxHash: string;
  BlockNumber: number;
  BlockHash: string;
  Asset: string;
  From: string;
  To: string;
  Amount: string;
  Memo: string;
}

export class EosHandler {
  private db: EosDb;
  private config: EosConfig;
  private chain: EosChain;
  constructor(db: EosDb, config: EosConfig) {
    this.db = db;
    this.config = config;
    this.chain = new EosChain(this.config.rpcUrl, new JsSignatureProvider(this.config.privateKeys));
  }

  async getUnlockRecords(status: EosUnlockStatus): Promise<EosUnlock[]> {
    return this.db.getEosUnlockRecordsToUnlock(status);
  }

  async sendUnlockTx(record: EosUnlock): Promise<TransactResult | PushTransactionArgs> {
    return this.chain.transfer(
      this.config.bridgerAccount,
      record.recipientAddress,
      this.config.bridgerAccountPermission,
      `${record.amount} ${record.asset}`,
      '',
      EosTokenAccount,
    );
  }

  async watchLockEvents() {
    let latestHeight = await this.db.getLatestHeight();
    if (latestHeight === 0) {
      const curBlockInfo = await this.chain.getCurrentBlockInfo();
      latestHeight = curBlockInfo.head_block_num;
    }
    await this.chain.subscribeBlock(
      latestHeight,
      async (block: GetBlockResult) => {
        for (const tx of block.transactions) {
          if (tx.status !== EosTransactionStatus) {
            continue;
          }
          for (const action of tx.trx.transaction.actions) {
            if (action.account !== EosTokenAccount || action.name !== EosTokenTransferActionName) {
              continue;
            }
            const data = action.data;
            if (data.to !== this.config.bridgerAccount) {
              continue;
            }
            const amountAsset = parseAssetAmount(data.quantity, EosDecimal);
            const lockEvent = {
              TxHash: tx.trx.id,
              BlockNumber: block.block_num,
              BlockHash: block.id,
              Asset: amountAsset.Asset,
              From: data.from,
              To: data.to,
              Amount: amountAsset.Amount,
              Memo: data.memo,
            };
            logger.info(
              `Eos watched transfer txHash:${tx.trx.id} from:${data.from} to:${data.to} amount:${lockEvent.Amount} asset:${lockEvent.Asset} memo:${data.memo}`,
            );
            await this.processLockEvent(lockEvent);
          }
        }
      },
      false,
    );
  }

  async processLockEvent(lockEvent: EosLockEvent) {
    const fragments = lockEvent.Memo.split('#');
    const recipientLockscript = fragments[0] ? fragments[0] : '';
    const sudtExtraData = fragments[1] ? fragments[1] : '';
    try {
      await this.db.createCkbMint([
        {
          id: lockEvent.TxHash,
          chain: ChainType.EOS,
          amount: lockEvent.Amount,
          asset: lockEvent.Asset,
          recipientLockscript: recipientLockscript,
          sudtExtraData: sudtExtraData,
        },
      ]);
      await this.db.createEosLock([
        {
          txHash: lockEvent.TxHash,
          amount: lockEvent.Amount,
          token: lockEvent.Asset,
          sender: lockEvent.From,
          recipientLockscript: recipientLockscript,
          sudtExtraData: sudtExtraData,
          blockHash: lockEvent.BlockHash,
          blockNumber: lockEvent.BlockNumber,
        },
      ]);
      logger.info(
        `process CkbMint and EosLock successful for eos tx:${lockEvent.TxHash} from:${lockEvent.From} amount:${lockEvent.Amount} asset:${lockEvent.Asset} memo:${lockEvent.Memo}.`,
      );
    } catch (e) {
      logger.error(
        `process eosLock event failed.tx:${lockEvent.TxHash} from:${lockEvent.From} amount:${lockEvent.Amount} asset:${lockEvent.Asset} memo:${lockEvent.Memo} error:${e}.`,
      );
    }
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
          logger.info(
            `EosUnlock process success ckbTxHash:${record.ckbTxHash} receiver:${record.recipientAddress} eosTxhash:${record.eosTxHash} amount:${record.amount}, asset:${record.asset}`,
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
