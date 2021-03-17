import { logger } from '../../utils/logger';
import { Api, JsonRpc } from 'eosjs';
import fetch from 'node-fetch/index';
import { TextDecoder, TextEncoder } from 'util';
import { SignatureProvider, TransactConfig, Transaction, TransactResult } from 'eosjs/dist/eosjs-api-interfaces';
import {
  GetAccountResult,
  GetBlockResult,
  GetInfoResult,
  GetTransactionResult,
  PushTransactionArgs,
} from 'eosjs/dist/eosjs-rpc-interfaces';

const SubscribeBatchSize = 16;
const SubscribeSleepTime = 1000;
type SubscribedBlockHandler = (block: GetBlockResult) => void;

export class EosChain {
  private readonly rpc: JsonRpc;
  private readonly signatureProvider: SignatureProvider;
  private readonly api: Api;

  constructor(rpcUrl: string, signatureProvider: SignatureProvider) {
    this.rpc = new JsonRpc(rpcUrl, { fetch });
    this.signatureProvider = signatureProvider;
    this.api = new Api({
      rpc: this.rpc,
      signatureProvider: signatureProvider,
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

  getAccountInfo(account: string): Promise<GetAccountResult> {
    return this.rpc.get_account(account);
  }

  transact(transaction: Transaction, transactCfg?: TransactConfig): Promise<TransactResult | PushTransactionArgs> {
    return this.api.transact(transaction, transactCfg);
  }

  async transfer(
    from: string,
    to: string,
    fromPermission: string,
    quantity: string,
    memo: string,
    tokenAccount = 'eosio.token',
  ): Promise<TransactResult | PushTransactionArgs> {
    return this.transact(
      {
        actions: [
          {
            account: tokenAccount,
            name: 'transfer',
            authorization: [
              {
                actor: from,
                permission: fromPermission,
              },
            ],
            data: {
              from: from,
              to: to,
              quantity: quantity,
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

  async subscribeBlock(startHeight: number, handler: SubscribedBlockHandler, onlyIrreversibleBlock = true) {
    const curBlockInfo = await this.getCurrentBlockInfo();
    let endHeight = curBlockInfo.last_irreversible_block_num;
    if (!onlyIrreversibleBlock) {
      endHeight = curBlockInfo.head_block_num;
    }
    await this.doSubscribeBlock(startHeight, endHeight, handler, onlyIrreversibleBlock);
  }

  private async doSubscribeBlock(
    startHeight: number,
    endHeight: number,
    handler: SubscribedBlockHandler,
    onlyIrreversibleBlock = true,
  ) {
    while (true) {
      if (startHeight > endHeight) {
        setTimeout(() => {
          this.subscribeBlock(startHeight, handler, onlyIrreversibleBlock);
        }, SubscribeSleepTime);
        return;
      }
      const block = await this.getBlock(startHeight);
      logger.debug(`Eos doSubscribeBlock blockHeight:${block.block_num} txNum:${block.transactions.length}`);
      handler(block);
      startHeight++;
    }
  }

  getTransactionResult(txHash: string): Promise<GetTransactionResult> {
    return this.rpc.history_get_transaction(txHash);
  }
}
