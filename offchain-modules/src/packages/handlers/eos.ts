import { logger } from '../utils/logger';
import { asyncSleep } from '../utils';
import { EosDb } from '@force-bridge/db/eos';
import { EosChain } from '@force-bridge/xchain/eos/eosChain';
import { EosUnlock, EosUnlockStatus } from '@force-bridge/db/entity/EosUnlock';
import { OrderedActionResult, PushTransactionArgs } from 'eosjs/dist/eosjs-rpc-interfaces';
import { EosConfig } from '@force-bridge/config';
import { EosAssetAmount, getTxIdFromSerializedTx } from '@force-bridge/xchain/eos/utils';
import { JsSignatureProvider } from 'eosjs/dist/eosjs-jssig';
import { ChainType } from '@force-bridge/ckb/model/asset';
import { getEosLockId } from '@force-bridge/db/entity/EosLock';
import { TransactResult } from 'eosjs/dist/eosjs-api-interfaces';
import { Amount } from '@lay2/pw-core';

const EosTokenAccount = 'eosio.token';
const EosTokenTransferActionName = 'transfer';

export class EosLockEvent {
  TxHash: string;
  ActionIndex: number;
  BlockNumber: number;
  ActionPos: number;
  GlobalActionSeq: number;
  Asset: string;
  Precision: number;
  From: string;
  To: string;
  Amount: string;
  Memo: string;
}

export class EosHandler {
  private db: EosDb;
  private config: EosConfig;
  private chain: EosChain;
  private readonly signatureProvider: JsSignatureProvider;
  private assetPrecisionCache: Map<string, number>;
  constructor(db: EosDb, config: EosConfig) {
    this.db = db;
    this.config = config;
    this.signatureProvider = new JsSignatureProvider(this.config.privateKeys);
    this.chain = new EosChain(this.config.rpcUrl, this.signatureProvider);
    this.assetPrecisionCache = new Map<string, number>();
  }

  setPrecision(symbol: string, precision: number) {
    this.assetPrecisionCache.set(symbol, precision);
  }

  async getPrecision(symbol: string): Promise<number> {
    let precision = this.assetPrecisionCache.get(symbol);
    if (precision) {
      return precision;
    }
    precision = await this.chain.getCurrencyPrecision(symbol);
    this.setPrecision(symbol, precision);
    return precision;
  }

  async getUnlockRecords(status: EosUnlockStatus): Promise<EosUnlock[]> {
    return this.db.getEosUnlockRecordsToUnlock(status);
  }

  async buildUnlockTx(record: EosUnlock): Promise<PushTransactionArgs> {
    return (await this.chain.transfer(
      this.config.bridgerAccount,
      record.recipientAddress,
      this.config.bridgerAccountPermission,
      `${new Amount(record.amount, 0).toString(await this.getPrecision(record.asset))} ${record.asset}`,
      '',
      EosTokenAccount,
      {
        broadcast: false,
        blocksBehind: 3,
        expireSeconds: 30,
        sign: false,
      },
    )) as PushTransactionArgs;
  }

  isLockAction(action: OrderedActionResult): boolean {
    const actionTrace = action.action_trace;
    const act = actionTrace.act;
    if (act.account !== EosTokenAccount || act.name !== EosTokenTransferActionName) {
      return false;
    }
    const data = act.data;
    if (data.to !== this.config.bridgerAccount) {
      return false;
    }
    return true;
  }

  async processAction(pos: number, action: OrderedActionResult) {
    const actionTrace = action.action_trace;
    const act = actionTrace.act;
    const data = act.data;
    const amountAsset = EosAssetAmount.assetAmountFromQuantity(data.quantity);
    this.setPrecision(amountAsset.Asset, amountAsset.Precision);
    const lockEvent = {
      TxHash: actionTrace.trx_id,
      ActionIndex: actionTrace.action_ordinal,
      BlockNumber: actionTrace.block_num,
      ActionPos: pos,
      GlobalActionSeq: action.global_action_seq,
      Asset: amountAsset.Asset,
      Precision: amountAsset.Precision,
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

  async doWatchLockEventsInDescOrder(latestActionSeq: number) {
    let pos = 0;
    const offset = 20;
    while (true) {
      if (pos < 0) {
        pos = 0;
        await asyncSleep(3000);
      }

      let actions;
      try {
        actions = await this.chain.getActions(this.config.bridgerAccount, pos, offset);
      } catch (e) {
        logger.error(`EosHandler getActions pos:${pos} offset:${offset} error:${e}`);
        await asyncSleep(3000);
        continue;
      }

      const actLen = actions.actions.length;
      if (actLen === 0) {
        pos -= offset;
        continue;
      }

      const firstAction = actions.actions[0];
      if (latestActionSeq < 0) {
        //init
        latestActionSeq = firstAction.global_action_seq;
      }
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
        if (!this.isLockAction(action)) {
          continue;
        }
        await this.processAction(0, action); //don't need in desc order
      }
      if (hasReversibleAction) {
        //wait actions become irreversible
        await asyncSleep(3000);
      } else {
        pos -= offset;
      }
    }
  }

  async doWatchLockEventsInAscOrder(latestActionSeq: number) {
    const lastActionPos = await this.db.getActionPos(latestActionSeq);
    const offset = 20;
    let pos = lastActionPos;
    while (true) {
      let actions;
      try {
        actions = await this.chain.getActions(this.config.bridgerAccount, pos, offset);
      } catch (e) {
        logger.error(`EosHandler getActions pos:${pos} offset:${offset} error:${e}`);
        await asyncSleep(3000);
        continue;
      }

      const actLen = actions.actions.length;
      if (actLen === 0) {
        await asyncSleep(3000);
        continue;
      }

      let hasReversibleAction = false;
      for (let i = 0; i <= actLen - 1; i++) {
        const action = actions.actions[i];
        if (action.global_action_seq <= latestActionSeq) {
          continue;
        }
        if (this.config.onlyWatchIrreversibleBlock && action.block_num > actions.last_irreversible_block) {
          hasReversibleAction = true;
          break;
        }
        latestActionSeq = action.global_action_seq;
        if (!this.isLockAction(action)) {
          continue;
        }
        await this.processAction(pos + 1, action); //don't need in desc order
      }

      if (hasReversibleAction) {
        //wait actions become irreversible
        await asyncSleep(3000);
      } else {
        pos += actLen;
      }
    }
  }

  async watchLockEvents() {
    //check chain id
    const curBlockInfo = await this.chain.getCurrentBlockInfo();
    if (curBlockInfo.chain_id != this.config.chainId) {
      logger.error(`EosHandler chainId:${curBlockInfo.chain_id} doesn't match with:${this.config.chainId}`);
      return;
    }

    while (true) {
      let actions;
      const pos = 0;
      const offset = 10;
      try {
        actions = await this.chain.getActions(this.config.bridgerAccount, pos, offset);
      } catch (e) {
        logger.error(`EosHandler getActions pos:${pos} offset:${offset} error:${e.toString()}`);
        await asyncSleep(3000);
      }
      const actLen = actions.actions.length;
      if (actLen === 0 || actLen === 1) {
        await asyncSleep(3000);
        continue;
      }

      let latestActionSeq = await this.db.getLastedGlobalActionSeq();
      if (latestActionSeq < this.config.latestGlobalActionSeq && this.config.latestGlobalActionSeq !== 0) {
        latestActionSeq = this.config.latestGlobalActionSeq;
      }

      //the order getAction is desc in jungle testnet, and asc in product env
      if (actions.actions[0].global_action_seq < actions.actions[actLen - 1].global_action_seq) {
        await this.doWatchLockEventsInAscOrder(latestActionSeq);
      } else {
        await this.doWatchLockEventsInDescOrder(latestActionSeq);
      }
      break;
    }
  }

  async processLockEvent(lockEvent: EosLockEvent) {
    const lockRecord = {
      id: getEosLockId(lockEvent.TxHash, lockEvent.ActionIndex),
      actionPos: lockEvent.ActionPos,
      globalActionSeq: lockEvent.GlobalActionSeq,
      txHash: lockEvent.TxHash,
      actionIndex: lockEvent.ActionIndex,
      amount: new Amount(lockEvent.Amount, lockEvent.Precision).toString(0),
      token: lockEvent.Asset,
      sender: lockEvent.From,
      memo: lockEvent.Memo,
      blockNumber: lockEvent.BlockNumber,
    };
    const fragments = lockRecord.memo.split(',');

    await this.db.createCkbMint([
      {
        id: lockRecord.id,
        chain: ChainType.EOS,
        amount: lockRecord.amount,
        asset: lockRecord.token,
        recipientLockscript: fragments[0] === undefined ? '0x' : fragments[0],
        sudtExtraData: fragments[1] === undefined ? '0x' : fragments[1],
      },
    ]);
    await this.db.createEosLock([lockRecord]);
    logger.info(
      `EosHandler process CkbMint and EosLock successful for eos tx:${lockEvent.TxHash} from:${lockEvent.From} amount:${lockEvent.Amount} asset:${lockEvent.Asset} memo:${lockEvent.Memo}.`,
    );
  }

  async watchUnlockEvents() {
    while (true) {
      try {
        const todoRecords = await this.getUnlockRecords('todo');
        if (todoRecords.length === 0) {
          await asyncSleep(15000);
          continue;
        }
        await this.processUnLockEvents(todoRecords);
      } catch (e) {
        logger.error('EosHandler watchUnlockEvents error:', e.toString());
        await asyncSleep(3000);
      }
    }
  }

  async processUnLockEvents(records: EosUnlock[]) {
    for (const record of records) {
      logger.info(`EosHandler processUnLockEvents get new unlockEvent:${JSON.stringify(record, null, 2)}`);
      record.status = 'pending';
      const unlockTx = await this.buildUnlockTx(record);
      if (this.config.privateKeys.length === 0) {
        logger.error('Eos empty bridger account private keys');
        return;
      }
      let signatures = [];
      for (const pubKey of this.config.publicKeys) {
        const signedTx = await this.signatureProvider.sign({
          chainId: this.config.chainId,
          requiredKeys: [pubKey],
          serializedTransaction: unlockTx.serializedTransaction,
          serializedContextFreeData: unlockTx.serializedContextFreeData,
          abis: null,
        });
        signatures.push(signedTx.signatures[0]);
      }
      unlockTx.signatures = signatures;
      const txHash = getTxIdFromSerializedTx(unlockTx.serializedTransaction);
      record.eosTxHash = txHash;
      await this.db.saveEosUnlock([record]); //save txHash first
      let txRes: TransactResult;
      try {
        txRes = await this.chain.pushSignedTransaction(unlockTx);
        logger.info(
          `EosHandler pushSignedTransaction ckbTxHash:${record.ckbTxHash} receiver:${record.recipientAddress} eosTxhash:${record.eosTxHash} amount:${record.amount} asset:${record.asset}`,
        );
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
          await this.db.saveEosUnlock([record]);
        }
      } catch (e) {
        record.status = 'error';
        record.message = e.message;
        logger.error(
          `EosHandler pushSignedTransaction failed eosTxHash:${txHash} ckbTxHash:${record.ckbTxHash} receiver:${
            record.recipientAddress
          } amount:${record.amount} asset:${record.asset} error:${e.toString()}`,
        );
        await this.db.saveEosUnlock([record]);
      }
    }
  }

  async checkUnlockTxStatus() {
    if (!this.config.onlyWatchIrreversibleBlock) {
      return;
    }

    while (true) {
      try {
        const pendingRecords = await this.getUnlockRecords('pending');
        if (pendingRecords.length === 0) {
          await asyncSleep(15000);
          continue;
        }
        const newRecords = new Array<EosUnlock>();
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
      } catch (e) {
        logger.error(`EosHandler checkUnlockTxStatus error:${e.toString()}`);
        await asyncSleep(3000);
      }
    }
  }

  start() {
    this.watchLockEvents();
    this.watchUnlockEvents();
    this.checkUnlockTxStatus();
    logger.info('eos handler started  🚀');
  }
}
