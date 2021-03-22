import { logger } from '../utils/logger';
import { asyncSleep } from '../utils';
import { EosDb } from '@force-bridge/db/eos';
import { EosChain } from '@force-bridge/xchain/eos/eosChain';
import { EosUnlock, EosUnlockStatus } from '@force-bridge/db/entity/EosUnlock';
import { TransactResult } from 'eosjs/dist/eosjs-api-interfaces';
import { PushTransactionArgs } from 'eosjs/dist/eosjs-rpc-interfaces';
import { EosConfig } from '@force-bridge/config';
import { parseAssetAmount } from '@force-bridge/xchain/eos/utils';
import { JsSignatureProvider } from 'eosjs/dist/eosjs-jssig';
import { ChainType } from '@force-bridge/ckb/model/asset';

const EosDecimal = 4;
const EosTokenAccount = 'eosio.token';
const EosTokenTransferActionName = 'transfer';

export class EosLockEvent {
  TxHash: string;
  ActionIndex: number;
  BlockNumber: number;
  AccountActionSeq: number;
  GlobalActionSeq: number;
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
    //check chain id
    const curBlockInfo = await this.chain.getCurrentBlockInfo();
    if (curBlockInfo.chain_id != this.config.chainId) {
      logger.error(`Eos chainId:${curBlockInfo.chain_id} doesn't match with:${this.config.chainId}`);
      return;
    }

    let latestActionSeq = await this.db.getLastedAccountActionSeq();
    if (latestActionSeq < this.config.latestAccountActionSeq) {
      latestActionSeq = this.config.latestAccountActionSeq;
    }

    let pos = 0;
    let forward = false;
    const offset = 20;
    while (true) {
      if (pos < 0) {
        pos = 0;
        await asyncSleep(3000);
      }

      const actions = await this.chain.getActions(this.config.bridgerAccount, pos, offset);
      const actLen = actions.actions.length;
      if (actLen === 0) {
        pos -= offset + 1;
        forward = true;
        continue;
      }

      const firstAction = actions.actions[0];
      const lastAction = actions.actions[actLen - 1];
      if (lastAction.account_action_seq > latestActionSeq && !forward) {
        pos += offset + 1;
        forward = false;
        continue;
      }
      if (firstAction.account_action_seq < latestActionSeq) {
        pos -= offset + 1;
        forward = true;
        continue;
      }

      for (let i = actLen - 1; i >= 0; i--) {
        const action = actions.actions[i];
        if (action.account_action_seq <= latestActionSeq) {
          continue;
        }
        const actionTrace = action.action_trace;
        const act = actionTrace.act;
        if (act.account !== EosTokenAccount || act.name !== EosTokenTransferActionName) {
          continue;
        }
        const data = act.data;
        if (data.to !== this.config.bridgerAccount) {
          continue;
        }
        const amountAsset = parseAssetAmount(data.quantity, EosDecimal);
        const lockEvent = {
          TxHash: actionTrace.trx_id,
          ActionIndex: actionTrace.action_ordinal,
          BlockNumber: actionTrace.block_num,
          AccountActionSeq: action.account_action_seq,
          GlobalActionSeq: action.global_action_seq,
          Asset: amountAsset.Asset,
          From: data.from,
          To: data.to,
          Amount: amountAsset.Amount,
          Memo: data.memo,
        };
        logger.info(
          `Eos watched transfer blockNumber:${actionTrace.block_num} accountActionSeq:${action.account_action_seq} txHash:${actionTrace.trx_id} from:${data.from} to:${data.to} amount:${lockEvent.Amount} asset:${lockEvent.Asset} memo:${data.memo}`,
        );
        try {
          await this.processLockEvent(lockEvent);
          latestActionSeq = action.account_action_seq;
          pos -= offset + 1;
          forward = true;
        } catch (err) {
          logger.error(
            `process eosLock event failed. blockNumber:${actionTrace.block_num} tx:${lockEvent.TxHash} from:${lockEvent.From} amount:${lockEvent.Amount} asset:${lockEvent.Asset} memo:${lockEvent.Memo} error:${err}.`,
          );
        }
      }
    }
  }

  async processLockEvent(lockEvent: EosLockEvent) {
    const lockRecord = {
      id: `${lockEvent.TxHash}_${lockEvent.ActionIndex}`,
      accountActionSeq: lockEvent.AccountActionSeq,
      globalActionSeq: lockEvent.GlobalActionSeq,
      txHash: lockEvent.TxHash,
      actionIndex: lockEvent.ActionIndex,
      amount: lockEvent.Amount,
      token: lockEvent.Asset,
      sender: lockEvent.From,
      memo: lockEvent.Memo,
      blockNumber: lockEvent.BlockNumber,
    };

    await this.db.createCkbMint([
      {
        id: lockRecord.id,
        chain: ChainType.EOS,
        amount: lockRecord.amount,
        asset: lockRecord.token,
        recipientLockscript: lockEvent.Memo,
      },
    ]);
    await this.db.createEosLock([lockRecord]);
    logger.info(
      `process CkbMint and EosLock successful for eos tx:${lockEvent.TxHash} from:${lockEvent.From} amount:${lockEvent.Amount} asset:${lockEvent.Asset} memo:${lockEvent.Memo}.`,
    );
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
