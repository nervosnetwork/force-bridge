import { logger } from '../utils/logger';
import { asyncSleep } from '../utils';
import { EosDb } from '@force-bridge/db/eos';
import { EosChain } from '@force-bridge/xchain/eos/eosChain';
import { EosUnlock, EosUnlockStatus } from '@force-bridge/db/entity/EosUnlock';
import { PushTransactionArgs } from 'eosjs/dist/eosjs-rpc-interfaces';
import { EosConfig } from '@force-bridge/config';
import { EosAssetAmount, getTxIdFromSerializedTx } from '@force-bridge/xchain/eos/utils';
import { JsSignatureProvider } from 'eosjs/dist/eosjs-jssig';
import { ChainType } from '@force-bridge/ckb/model/asset';
import { getEosLockId } from '@force-bridge/db/entity/EosLock';
import { TransactResult } from 'eosjs/dist/eosjs-api-interfaces';

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

  async buildUnlockTx(record: EosUnlock): Promise<PushTransactionArgs> {
    return (await this.chain.transfer(
      this.config.bridgerAccount,
      record.recipientAddress,
      this.config.bridgerAccountPermission,
      `${record.amount} ${record.asset}`,
      '',
      EosTokenAccount,
      {
        broadcast: false,
        blocksBehind: 3,
        expireSeconds: 30,
      },
    )) as PushTransactionArgs;
  }

  async watchLockEvents() {
    try {
      //check chain id
      const curBlockInfo = await this.chain.getCurrentBlockInfo();
      if (curBlockInfo.chain_id != this.config.chainId) {
        logger.error(`EosHandler chainId:${curBlockInfo.chain_id} doesn't match with:${this.config.chainId}`);
        return;
      }

      let latestActionSeq = await this.db.getLastedGlobalActionSeq();
      if (latestActionSeq < this.config.latestGlobalActionSeq) {
        latestActionSeq = this.config.latestGlobalActionSeq;
      }

      let pos = 0;
      const offset = 20;
      while (true) {
        if (pos < 0) {
          pos = 0;
          await asyncSleep(3000);
        }

        const actions = await this.chain.getActions(this.config.bridgerAccount, pos, offset);
        const actLen = actions.actions.length;
        if (actLen === 0) {
          pos -= offset;
          continue;
        }

        const firstAction = actions.actions[0];
        const lastAction = actions.actions[actLen - 1];
        if (lastAction.global_action_seq > latestActionSeq) {
          pos += offset;
          continue;
        }
        if (firstAction.global_action_seq < latestActionSeq) {
          pos -= offset;
          continue;
        }

        let hasReversibleAction = false;
        for (let i = actLen - 1; i >= 0; i--) {
          const action = actions.actions[i];
          if (action.global_action_seq <= latestActionSeq) {
            continue;
          }
          if (this.config.onlyWatchIrreversibleBlock && action.block_num > actions.last_irreversible_block) {
            hasReversibleAction = true;
            break;
          }
          latestActionSeq = action.global_action_seq;

          const actionTrace = action.action_trace;
          const act = actionTrace.act;
          if (act.account !== EosTokenAccount || act.name !== EosTokenTransferActionName) {
            continue;
          }
          const data = act.data;
          if (data.to !== this.config.bridgerAccount) {
            continue;
          }
          const amountAsset = EosAssetAmount.assetAmountFromQuantity(data.quantity);
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
            `EosHandler watched transfer blockNumber:${actionTrace.block_num} globalActionSeq:${action.global_action_seq} txHash:${actionTrace.trx_id} from:${data.from} to:${data.to} amount:${lockEvent.Amount} asset:${lockEvent.Asset} memo:${data.memo}`,
          );
          try {
            await this.processLockEvent(lockEvent);
          } catch (err) {
            logger.error(
              `EosHandler process eosLock event failed. blockNumber:${actionTrace.block_num} globalActionSeq:${action.global_action_seq} tx:${lockEvent.TxHash} from:${lockEvent.From} amount:${lockEvent.Amount} asset:${lockEvent.Asset} memo:${lockEvent.Memo} error:${err}.`,
            );
          }
        }
        if (hasReversibleAction) {
          //wait actions become irreversible
          await asyncSleep(3000);
        } else {
          pos -= offset;
        }
      }
    } catch (e) {
      logger.error('EosHandler watchLockEvents error:', e);
      setTimeout(this.watchLockEvents, 3000);
    }
  }

  async processLockEvent(lockEvent: EosLockEvent) {
    const lockRecord = {
      id: getEosLockId(lockEvent.TxHash, lockEvent.ActionIndex),
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
      `EosHandler process CkbMint and EosLock successful for eos tx:${lockEvent.TxHash} from:${lockEvent.From} amount:${lockEvent.Amount} asset:${lockEvent.Asset} memo:${lockEvent.Memo}.`,
    );
  }

  async watchUnlockEvents() {
    try {
      while (true) {
        const todoRecords = await this.getUnlockRecords('todo');
        if (todoRecords.length === 0) {
          await asyncSleep(15000);
          continue;
        }
        await this.processUnLockEvents(todoRecords);
      }
    } catch (e) {
      logger.error('EosHandler watchUnlockEvents error:', e);
      setTimeout(this.watchUnlockEvents, 3000);
    }
  }

  async processUnLockEvents(records: EosUnlock[]) {
    for (const record of records) {
      record.status = 'pending';
      const pushTxArgs = await this.buildUnlockTx(record);
      const txHash = getTxIdFromSerializedTx(pushTxArgs.serializedTransaction);
      record.eosTxHash = txHash;
      await this.db.saveEosUnlock([record]); //save txHash first
      let txRes: TransactResult;
      try {
        txRes = await this.chain.pushSignedTransaction(pushTxArgs);
        logger.info(
          `EosHandler pushSignedTransaction ckbTxHash:${record.ckbTxHash} receiver:${record.recipientAddress} eosTxhash:${record.eosTxHash} amount:${record.amount} asset:${record.asset}`,
        );
      } catch (e) {
        record.status = 'error';
        record.message = e.message;
        logger.error(
          `EosHandler pushSignedTransaction failed eosTxHash:${txHash} ckbTxHash:${record.ckbTxHash} receiver:${record.recipientAddress} amount:${record.amount} asset:${record.asset} error:${e}`,
        );
      }
      if (!this.config.onlyWatchIrreversibleBlock) {
        const txStatus = txRes.processed.receipt.status;
        if (txStatus === 'executed') {
          record.status = 'success';
        } else {
          record.status = 'error';
          record.message = `action status:${txStatus} doesn't executed`;
          logger.error(
            `EosHandler processUnLockEvents eosTxHash:${txHash} ckbTxHash:${record.ckbTxHash} receiver:${record.recipientAddress} amount:${record.amount} asset:${record.asset} action status:${txStatus} doesn't executed`,
          );
        }
      }
      await this.db.saveEosUnlock([record]);
    }
  }

  async checkUnlockTxStatus() {
    if (!this.config.onlyWatchIrreversibleBlock) {
      return;
    }
    try {
      while (true) {
        const pendingRecords = await this.getUnlockRecords('pending');
        if (pendingRecords.length === 0) {
          await asyncSleep(15000);
          continue;
        }
        let newRecords = new Array<EosUnlock>();
        for (const pendingRecord of pendingRecords) {
          const txRes = await this.chain.getTransaction(pendingRecord.eosTxHash);
          if ('error' in txRes) {
            const {
              error: { code, name, what },
            } = txRes;
            pendingRecord.status = 'error';
            pendingRecord.message = `rpcError ${code}-${name}:${what}`;
            newRecords.push(pendingRecord);
            continue;
          }
          if (txRes.trx.receipt.status !== 'executed') {
            pendingRecord.status = 'error';
            pendingRecord.message = `invalid transaction result status:${txRes.trx.receipt.status}`;
            newRecords.push(pendingRecord);
            continue;
          }
          if (txRes.block_num <= txRes.last_irreversible_block) {
            pendingRecord.status = 'success';
            newRecords.push(pendingRecord);
            logger.info(
              `EosHandler unlock status check success. ckbTxHash:${pendingRecord.ckbTxHash} receiver:${pendingRecord.recipientAddress} eosTxhash:${pendingRecord.eosTxHash} amount:${pendingRecord.amount}, asset:${pendingRecord.asset}`,
            );
          }
        }
        if (newRecords.length !== 0) {
          await this.db.saveEosUnlock(newRecords);
        }
      }
    } catch (e) {
      logger.error(`EosHandler checkUnlockTxStatus error:${e}`);
      setTimeout(this.checkUnlockTxStatus, 3000);
    }
  }

  start() {
    // this.watchLockEvents();
    // this.watchUnlockEvents();
    // this.checkUnlockTxStatus();
    logger.info('eos handler started  🚀');
  }
}
