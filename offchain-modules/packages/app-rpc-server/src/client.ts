import { ethers } from 'ethers';
import { JSONRPCClient, JSONRPCRequest } from 'json-rpc-2.0';
import fetch from 'node-fetch';
import {
  ForceBridgeAPIV1,
  GenerateBridgeInTransactionPayload,
  GenerateBridgeOutNervosTransactionPayload,
  GenerateTransactionResponse,
  GetBalancePayload,
  GetBalanceResponse,
  GetBridgeInNervosBridgeFeePayload,
  GetBridgeInNervosBridgeFeeResponse,
  GetBridgeOutNervosBridgeFeePayload,
  GetBridgeOutNervosBridgeFeeResponse,
  GetBridgeTransactionStatusPayload,
  GetBridgeTransactionStatusResponse,
  GetBridgeTransactionSummariesPayload,
  GetBridgeConfigResponse,
  SignedTransactionPayload,
  TransactionIdent,
  TransactionSummaryWithStatus,
  BlockChainNetWork,
  GetMinimalBridgeAmountPayload,
  GetMinimalBridgeAmountResponse,
  GenerateBridgeNervosToXchainLockTxPayload,
  GenerateBridgeNervosToXchainBurnTxPayload,
  GetBridgeNervosToXchainTxSummariesPayload,
} from './types/apiv1';
import { NetworkBase, NetworkTypes, RequiredAsset } from './types/network';

export class ForceBridgeAPIV1Client implements ForceBridgeAPIV1 {
  client: JSONRPCClient;

  constructor(forceBridgeUrl: string) {
    this.client = new JSONRPCClient((jsonRPCRequest: JSONRPCRequest) =>
      fetch(forceBridgeUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(jsonRPCRequest),
      }).then((response) => {
        if (response.status === 200) {
          // Use client.receive when you received a JSON-RPC response.
          return response.json().then((jsonRPCResponse) => this.client.receive(jsonRPCResponse));
        } else if (jsonRPCRequest.id !== undefined) {
          return Promise.reject(new Error(response.statusText));
        } else {
          return Promise.reject(new Error('request id undefined'));
        }
      }),
    );
  }

  getMinimalBridgeAmount(payload: GetMinimalBridgeAmountPayload): Promise<GetMinimalBridgeAmountResponse> {
    return Promise.resolve(this.client.request('getMinimalBridgeAmount', payload));
  }

  getBridgeInNervosBridgeFee(payload: GetBridgeInNervosBridgeFeePayload): Promise<GetBridgeInNervosBridgeFeeResponse> {
    return Promise.resolve(this.client.request('getBridgeInNervosBridgeFee', payload));
  }

  getBridgeOutNervosBridgeFee(
    payload: GetBridgeOutNervosBridgeFeePayload,
  ): Promise<GetBridgeOutNervosBridgeFeeResponse> {
    return Promise.resolve(Promise.resolve(this.client.request('getBridgeOutNervosBridgeFee', payload)));
  }

  async generateBridgeInNervosTransaction<T extends NetworkTypes>(
    payload: GenerateBridgeInTransactionPayload,
  ): Promise<GenerateTransactionResponse<T>> {
    const result = await this.client.request('generateBridgeInNervosTransaction', payload);
    switch (result.network) {
      case 'Ethereum':
        {
          const rawTx = result.rawTransaction;
          rawTx.value = ethers.BigNumber.from(rawTx.value.hex ? rawTx.value.hex : 0);
          result.rawTransaction = rawTx;
        }
        break;
      default:
        //TODO add other chains
        void Promise.reject(new Error('not yet'));
    }
    return result;
  }

  async generateBridgeOutNervosTransaction<T extends NetworkTypes>(
    payload: GenerateBridgeOutNervosTransactionPayload,
  ): Promise<GenerateTransactionResponse<T>> {
    return this.client.request('generateBridgeOutNervosTransaction', payload);
  }

  async sendSignedTransaction<T extends NetworkBase>(payload: SignedTransactionPayload<T>): Promise<TransactionIdent> {
    return this.client.request('sendSignedTransaction', payload);
  }

  async getBridgeTransactionStatus(
    payload: GetBridgeTransactionStatusPayload,
  ): Promise<GetBridgeTransactionStatusResponse> {
    return this.client.request('getBridgeTransactionStatus', payload);
  }

  async getBridgeTransactionSummaries(
    payload: GetBridgeTransactionSummariesPayload<BlockChainNetWork>,
  ): Promise<TransactionSummaryWithStatus[]> {
    return await this.client.request('getBridgeTransactionSummaries', payload);
  }

  async getAssetList(name?: string): Promise<RequiredAsset<'info'>[]> {
    let param = { asset: name };
    if (name == undefined) {
      param = { asset: 'all' };
    }
    return this.client.request('getAssetList', param);
  }

  async getBalance(payload: GetBalancePayload): Promise<GetBalanceResponse> {
    return this.client.request('getBalance', payload);
  }

  async getBridgeConfig(): Promise<GetBridgeConfigResponse> {
    return this.client.request('getBridgeConfig');
  }

  /* Bridge nervos asset to xchain */
  async generateBridgeNervosToXchainLockTx<T extends NetworkTypes>(
    payload: GenerateBridgeNervosToXchainLockTxPayload,
  ): Promise<GenerateTransactionResponse<T>> {
    return await this.client.request('generateBridgeNervosToXchainLockTx', payload);
  }

  async generateBridgeNervosToXchainBurnTx<T extends NetworkTypes>(
    payload: GenerateBridgeNervosToXchainBurnTxPayload,
  ): Promise<GenerateTransactionResponse<T>> {
    const result = await this.client.request('generateBridgeNervosToXchainBurnTx', payload);
    switch (result.network) {
      case 'Ethereum':
        {
          const rawTx = result.rawTransaction;
          rawTx.value = ethers.BigNumber.from(rawTx.value.hex ? rawTx.value.hex : 0);
          result.rawTransaction = rawTx;
        }
        break;
      default:
        throw new Error('unimplement');
    }
    return result;
  }

  async getBridgeNervosToXchainTxSummaries(
    payload: GetBridgeNervosToXchainTxSummariesPayload,
  ): Promise<TransactionSummaryWithStatus[]> {
    return await this.client.request('getBridgeNervosToXchainTxSummaries', payload);
  }
}
