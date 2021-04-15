import { CkbTxGenerator } from '../../packages/ckb/tx-helper/generator';
import { IndexerCollector } from '../../packages/ckb/tx-helper/collector';
import { EthAsset, TronAsset } from '../../packages/ckb/model/asset';
import { Amount } from '@lay2/pw-core';
import { CommitteeFungibleForceBridgeAPIV1 } from './types';
import { ForceBridgeCore } from '../../packages/core';
import { Script } from '@lay2/pw-core';

import { ethers } from 'ethers';
import { abi } from '../../packages/xchain/eth/abi/ForceBridge.json';

const TronWeb = require('tronweb');
import { getAssetTypeByAsset } from '../../packages/xchain/tron/utils';

export class ForceBridgeAPIV1 implements CommitteeFungibleForceBridgeAPIV1 {
  async generateBridgeInNervosTransaction(payload): Promise<any> {
    console.log('generateBridgeInNervosTransaction ', payload);

    const sender = payload.sender;
    const recipientLockscript = Script.fromRPC({
      code_hash: payload.recipient.codeHash,
      args: payload.recipient.args,
      hash_type: payload.recipient.hashType,
    });
    const amount = payload.asset.amount;

    const network = payload.asset.ident.network;
    let tx;
    switch (network) {
      case 'Ethereum':
        // const bridgeContractAddr = ForceBridgeCore.config.eth.contractAddress;
        // const bridge = new ethers.Contract(bridgeContractAddr, abi);
        break;
      case 'Tron':
        const tronWeb = new TronWeb({
          fullHost: ForceBridgeCore.config.tron.tronGridUrl,
        });
        const committee = ForceBridgeCore.config.tron.committee.address;
        const assetType = getAssetTypeByAsset(payload.asset.ident.address);
        switch (assetType) {
          case 'trx':
            // const from_hex = tronWeb.address.toHex(sender);
            // const to_hex = tronWeb.address.toHex(committee);
            // console.log(from_hex, to_hex);
            const unsignedTx = await tronWeb.transactionBuilder.sendTrx(committee, amount, sender);
            const memo = recipientLockscript.toAddress().toCKBAddress().concat(',').concat('sudt extra data');
            tx = await tronWeb.transactionBuilder.addUpdateData(unsignedTx, memo, 'utf8');
            break;
          case 'trc10':
            break;
          case 'trc20':
            break;
          default:
            Promise.reject(new Error('invalid tron asset type'));
        }
      default:
        Promise.reject(new Error('invalid chain type'));
    }
    return {
      rawTransaction: JSON.stringify(tx),
      bridgeFee: {
        ident: { network: 'Ethereum', address: '0x000' },
        amount: '0x0',
      },
    };
  }

  async generateBridgeOutNervosTransaction(payload): Promise<any> {
    console.log('generateBridgeOutNervosTransaction ', payload);
    const fromLockscript = Script.fromRPC({
      code_hash: payload.sender.codeHash,
      args: payload.sender.args,
      hash_type: payload.sender.hashType,
    });
    const ownLockHash = ForceBridgeCore.ckb.utils.scriptToHash(<CKBComponents.Script>fromLockscript);

    const network = payload.asset.ident.network;
    const assetName = payload.asset.ident.address;

    let asset;
    switch (network) {
      case 'Ethereum':
        asset = new EthAsset(assetName, ownLockHash);
        break;
      case 'Tron':
        asset = new TronAsset(assetName, ownLockHash);
        break;
      default:
        Promise.reject(new Error('invalid chain type'));
    }

    const amount = payload.asset.amount;

    const ckbTxGenerator = new CkbTxGenerator(ForceBridgeCore.ckb, new IndexerCollector(ForceBridgeCore.indexer));
    const burnTx = await ckbTxGenerator.burn(fromLockscript, payload.recipient, asset, new Amount(amount));
    return {
      rawTransaction: JSON.stringify(burnTx),
      bridgeFee: {
        ident: { network: 'Ethereum', address: '0x000' },
        amount: '0x1',
      },
    };
  }

  async sendBridgeOutNervosTransaction(payload): Promise<any> {
    console.log('sendBridgeOutNervosTransaction', payload);
    const signedTx = JSON.parse(payload.signedTransaction);
    const burnTxHash = await ForceBridgeCore.ckb.rpc.sendTransaction(signedTx);
    return {
      network: 'Ckb',
      txId: burnTxHash,
    };
  }

  async sendBridgeInNervosTransaction(payload): Promise<any> {
    const network = payload.network;
    let txId;
    switch (network) {
      case 'Tron':
        const signedTx = JSON.parse(payload.signedTransaction);
        const tronWeb = new TronWeb({
          fullHost: ForceBridgeCore.config.tron.tronGridUrl,
        });
        const broadTx = await tronWeb.trx.broadcast(signedTx);
        txId = broadTx.transaction.txID;
        break;
      default:
        Promise.reject(new Error('invalid chain type'));
    }
    return {
      network: network,
      txId: txId,
    };
  }

  async getBridgeTransactionSummary(payload): Promise<any> {
    Promise.reject(new Error('not yet'));
  }
  async getBridgeTransactionSummaries(payload): Promise<any> {
    Promise.reject(new Error('not yet'));
  }
  async getAssetList(payload): Promise<any> {
    Promise.reject(new Error('not yet'));
  }
  async getBalance(payload): Promise<any> {
    Promise.reject(new Error('not yet'));
  }
}
