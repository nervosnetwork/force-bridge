import { logger } from '../../utils/logger';
import { Api, JsonRpc } from 'eosjs';
import { JsSignatureProvider } from 'eosjs/dist/eosjs-jssig';
import fetch from 'node-fetch/index';
import { TextDecoder, TextEncoder } from 'util';
import { ForceBridgeCore } from '@force-bridge/core';
import {
  GetAccountResult,
  GetBlockResult,
  GetInfoResult,
  GetTransactionResult,
  PushTransactionArgs,
} from 'eosjs/dist/eosjs-rpc-interfaces';
import { TransactResult } from 'eosjs/dist/eosjs-api-interfaces';

const EosAsset = 'eos';
const EosTokenAccount = 'eosio.token';
const EosTokenTransferActionName = 'transfer';
const EosTransactionStatus = 'executed';

const WatchSleepInterval = 1000;

export class EosLockRecord {
  TxHash: string;
  BlockNumber: number;
  BlockHash: string;
  Asset: string;
  From: string;
  To: string;
  Amount: string;
  Memo: string;
}

type LockRecordHandleFunc = (record: EosLockRecord) => void;

export class EosChain {
  private readonly privateKeys: string[];
  private readonly bridgeAccount: string;
  private readonly bridgeAccountPermission: string;
  private readonly chainId: string;
  private readonly rpc: JsonRpc;
  private readonly api: Api;

  constructor() {
    const config = ForceBridgeCore.config.eos;
    this.chainId = config.chainId;
    this.privateKeys = config.privateKeys;
    this.bridgeAccount = config.bridgerAccount;
    this.bridgeAccountPermission = config.bridgerAccountPermission;
    this.rpc = new JsonRpc(config.rpcUrl, { fetch });
    this.api = new Api({
      rpc: this.rpc,
      signatureProvider: new JsSignatureProvider(this.privateKeys),
      textDecoder: new TextDecoder(),
      textEncoder: new TextEncoder(),
    });
  }

  getCurrentBlockInfo(): Promise<GetInfoResult> {
    return this.rpc.get_info();
  }

  getBlock(blockNumberOrId: number | string): Promise<GetBlockResult> {
    return this.rpc.get_block(blockNumberOrId);
  }

  getBridgeAccountInfo(): Promise<GetAccountResult> {
    return this.rpc.get_account(this.bridgeAccount);
  }

  async watchLockRecords(startHeight: number, handleFunc: LockRecordHandleFunc) {
    const curBlockInfo = await this.getCurrentBlockInfo();
    if (curBlockInfo.chain_id !== this.chainId) {
      logger.error(`Eos chainId:${curBlockInfo.chain_id} doesn't match with:${this.chainId}`);
      return;
    }
    await this.doWatchLockRecord(startHeight, curBlockInfo.head_block_num, handleFunc);
  }

  private async doWatchLockRecord(startHeight: number, endHeight: number, handleFunc: LockRecordHandleFunc) {
    while (true) {
      if (startHeight > endHeight) {
        setTimeout(() => {
          this.watchLockRecords(startHeight, handleFunc);
        }, WatchSleepInterval);
        return;
      }
      const block = await this.getBlock(startHeight);
      logger.debug(`Eos doWatchLockRecord blockHeight:${block.block_num} txNum:${block.transactions.length}`);
      for (const tx of block.transactions) {
        if (tx.status !== EosTransactionStatus) {
          continue;
        }
        for (const action of tx.trx.transaction.actions) {
          if (action.account !== EosTokenAccount || action.name !== EosTokenTransferActionName) {
            continue;
          }
          const data = action.data;
          if (data.to !== this.bridgeAccount) {
            continue;
          }
          const lockRecord = {
            TxHash: tx.trx.id,
            BlockNumber: block.block_num,
            BlockHash: block.id,
            Asset: EosAsset,
            From: data.from,
            To: data.to,
            Amount: data.quantity,
            Memo: data.memo,
          };
          handleFunc(lockRecord);
          logger.info(
            `Eos watch transfer txHash:${tx.trx.id} from:${data.from} to:${data.to} amount:${data.quantity} memo:${data.memo}`,
          );
        }
      }
      startHeight++;
    }
  }

  transferTo(to: string, amount: string, memo: string): Promise<TransactResult | PushTransactionArgs> {
    return this.api.transact(
      {
        actions: [
          {
            account: EosTokenAccount,
            name: EosTokenTransferActionName,
            authorization: [
              {
                actor: this.bridgeAccount,
                permission: this.bridgeAccountPermission,
              },
            ],
            data: {
              from: this.bridgeAccount,
              to: to,
              quantity: amount,
              memo: memo,
            },
          },
        ],
      },
      {
        blocksBehind: 3,
        expireSeconds: 30,
      },
    );
  }

  getTransactionResult(txHash: string): Promise<GetTransactionResult> {
    return this.rpc.history_get_transaction(txHash);
  }
}
