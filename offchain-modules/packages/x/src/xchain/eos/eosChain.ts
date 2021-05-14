import { TextDecoder, TextEncoder } from 'util';
import { Api, JsonRpc } from 'eosjs';
import { SignatureProvider, TransactConfig, Transaction, TransactResult } from 'eosjs/dist/eosjs-api-interfaces';
import {
  GetAccountResult,
  GetActionsResult,
  GetBlockResult,
  GetCurrencyStatsResult,
  GetInfoResult,
  GetTransactionResult,
  PushTransactionArgs,
} from 'eosjs/dist/eosjs-rpc-interfaces';
import fetch from 'node-fetch/index';
import { EosAssetAmount } from './utils';

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

  getCurrencyStats(symbol: string, code: string): Promise<GetCurrencyStatsResult> {
    return this.rpc.get_currency_stats(code, symbol);
  }

  getCurrencyBalance(account: string, symbol: string, code = 'eosio.token'): Promise<string[]> {
    return this.rpc.get_currency_balance(code, account, symbol);
  }

  async getCurrencyPrecision(symbol: string, code = 'eosio.token'): Promise<number> {
    const stats = await this.getCurrencyStats(symbol, code);
    const assetAmount = EosAssetAmount.assetAmountFromQuantity(stats[symbol].supply);
    return assetAmount.Precision;
  }

  async transfer(
    from: string,
    to: string,
    fromPermission: string,
    quantity: string,
    memo: string,
    tokenAccount = 'eosio.token',
    transactCfg?: TransactConfig,
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
      transactCfg,
    );
  }

  pushSignedTransaction({
    signatures,
    serializedTransaction,
    serializedContextFreeData,
  }: PushTransactionArgs): Promise<TransactResult> {
    return this.api.pushSignedTransaction({ signatures, serializedTransaction, serializedContextFreeData });
  }

  //getActions actions ordered by desc related with account，bound:[pos, pos+offset]
  getActions(account: string, pos: number, offset?: number): Promise<GetActionsResult> {
    return this.rpc.history_get_actions(account, pos, offset);
  }

  getTransaction(txHash: string): Promise<GetTransactionResult> {
    return this.rpc.history_get_transaction(txHash);
  }
}
