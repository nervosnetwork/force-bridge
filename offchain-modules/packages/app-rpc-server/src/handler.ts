import { Asset, BtcAsset, EosAsset, EthAsset, TronAsset } from '@force-bridge/x/dist/ckb/model/asset';
import { IndexerCollector } from '@force-bridge/x/dist/ckb/tx-helper/collector';
import { CkbTxGenerator } from '@force-bridge/x/dist/ckb/tx-helper/generator';
import { getOwnLockHash } from '@force-bridge/x/dist/ckb/tx-helper/multisig/multisig_helper';
import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { EthDb, TronDb } from '@force-bridge/x/dist/db';
import { BtcDb } from '@force-bridge/x/dist/db/btc';
import { EosDb } from '@force-bridge/x/dist/db/eos';
import { IQuery, LockRecord, UnlockRecord } from '@force-bridge/x/dist/db/model';
import { stringToUint8Array } from '@force-bridge/x/dist/utils';
import { logger } from '@force-bridge/x/dist/utils/logger';
import { IBalance } from '@force-bridge/x/dist/xchain/btc';
import { abi } from '@force-bridge/x/dist/xchain/eth/abi/ForceBridge.json';
import { Amount, HashType, Script } from '@lay2/pw-core';
import { BigNumber } from 'bignumber.js';
import bitcore from 'bitcore-lib';
import { ethers } from 'ethers';
import { RPCClient } from 'rpc-bitcoin';
import { Connection } from 'typeorm';
import Web3 from 'web3';
import { AbiItem } from 'web3-utils';
import { API, AssetType, NetworkBase, NetworkTypes } from './types';
import {
  BalancePayload,
  BridgeTransactionStatus,
  GetBalancePayload,
  GetBalanceResponse,
  GetBridgeTransactionSummariesPayload,
  GetBridgeInNervosBridgeFeePayload,
  GetBridgeOutNervosBridgeFeePayload,
  GetBridgeInNervosBridgeFeeResponse,
  GetBridgeOutNervosBridgeFeeResponse,
  TransactionSummary,
  TransactionSummaryWithStatus,
  XChainNetWork,
} from './types/apiv1';
// The minimum ABI to get ERC20 Token balance
const minERC20ABI = [
  // balanceOf
  {
    constant: true,
    inputs: [{ name: '_owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: 'balance', type: 'uint256' }],
    type: 'function',
  },
  // decimals
  {
    constant: true,
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    type: 'function',
  },
];

export class ForceBridgeAPIV1Handler implements API.ForceBridgeAPIV1 {
  connection: Connection;
  web3: Web3;
  constructor(conn: Connection) {
    this.connection = conn;
    this.web3 = new Web3(ForceBridgeCore.config.eth.rpcUrl);
  }

  async generateBridgeInNervosTransaction<T extends NetworkTypes>(
    payload: API.GenerateBridgeInTransactionPayload,
  ): Promise<API.GenerateTransactionResponse<T>> {
    logger.info('generateBridgeInNervosTransaction ', payload);

    const sender = payload.sender;

    const network = payload.asset.network;
    let tx;
    switch (network) {
      case 'Ethereum': {
        checkETHAmount(payload.asset.ident, payload.asset.amount);
        const provider = new ethers.providers.JsonRpcProvider(ForceBridgeCore.config.eth.rpcUrl);
        const bridgeContractAddr = ForceBridgeCore.config.eth.contractAddress;
        const bridge = new ethers.Contract(bridgeContractAddr, abi, provider);
        const sudtExtraData = '0x';
        const ethAmount = ethers.utils.parseUnits(payload.asset.amount, 0);
        const recipient = stringToUint8Array(payload.recipient);

        switch (payload.asset.ident) {
          // TODO: use EthereumModel.isNativeAsset to identify token
          case '0x0000000000000000000000000000000000000000':
            tx = await bridge.populateTransaction.lockETH(recipient, sudtExtraData, {
              value: ethAmount,
            });
            break;
          default:
            tx = await bridge.populateTransaction.lockToken(payload.asset.ident, ethAmount, recipient, sudtExtraData);
            break;
        }
        break;
      }
      // case 'Tron':
      //   const tronWeb = new TronWeb({
      //     fullHost: ForceBridgeCore.config.tron.tronGridUrl,
      //   });
      //   const committee = ForceBridgeCore.config.tron.committee.address;
      //   const assetType = getAssetTypeByAsset(payload.asset.ident.address);
      //   let unsignedTx;
      //   switch (assetType) {
      //     case 'trx':
      //       unsignedTx = await tronWeb.transactionBuilder.sendTrx(committee, amount, sender);
      //       break;
      //     case 'trc10':
      //       unsignedTx = await tronWeb.transactionBuilder.sendToken(
      //         committee,
      //         amount,
      //         payload.asset.ident.address,
      //         sender,
      //       );
      //       break;
      //     case 'trc20':
      //       const options = {};
      //       const functionSelector = 'transfer(address,uint256)';
      //       const params = [
      //         { type: 'address', value: committee },
      //         { type: 'uint256', value: amount },
      //       ];
      //       unsignedTx = await tronWeb.transactionBuilder.triggerSmartContract(
      //         payload.asset.ident.address,
      //         functionSelector,
      //         options,
      //         params,
      //         sender,
      //       );
      //       break;
      //     default:
      //       Promise.reject(new Error('invalid tron asset type'));
      //   }
      //   const memo = recipientLockscript.toAddress().toCKBAddress().concat(',').concat('sudt extra data');
      //   tx = await tronWeb.transactionBuilder.addUpdateData(unsignedTx, memo, 'utf8');
      default:
        // TODO: add other chains
        Promise.reject(new Error('invalid chain type'));
    }
    return {
      network: network,
      rawTransaction: tx,
    };
  }

  async generateBridgeOutNervosTransaction<T extends NetworkTypes>(
    payload: API.GenerateBridgeOutNervosTransactionPayload,
  ): Promise<API.GenerateTransactionResponse<T>> {
    logger.info('generateBridgeOutNervosTransaction ', payload);
    const fromLockscript = ForceBridgeCore.ckb.utils.addressToScript(payload.sender);
    const ownLockHash = getOwnLockHash(ForceBridgeCore.config.ckb.multisigScript);

    const network = payload.network;
    const assetName = payload.asset;
    const amount = payload.amount;

    let asset;
    switch (network) {
      case 'Ethereum':
        checkETHAmount(assetName, amount);

        asset = new EthAsset(assetName, ownLockHash);
        break;
      case 'Tron':
        asset = new TronAsset(assetName, ownLockHash);
        break;
      default:
        //TODO: add other chains
        Promise.reject(new Error('invalid chain type'));
    }

    const script = Script.fromRPC({
      code_hash: fromLockscript.codeHash,
      args: fromLockscript.args,
      hash_type: fromLockscript.hashType,
    });
    const ckbTxGenerator = new CkbTxGenerator(ForceBridgeCore.ckb, ForceBridgeCore.ckbIndexer);
    const burnTx = await ckbTxGenerator.burn(script, payload.recipient, asset, new Amount(amount, 0));
    return {
      network: 'Nervos',
      rawTransaction: burnTx,
    };
  }

  async sendSignedTransaction<T extends NetworkBase>(
    payload: API.SignedTransactionPayload<T>,
  ): Promise<API.TransactionIdent> {
    // const network = payload.network;
    // let txId;
    // switch (network) {
    //   case 'Nervos':
    //     txId = await ForceBridgeCore.ckb.rpc.sendTransaction(JSON.parse(payload.signedTransaction));
    //     break;
    //   case 'Ethereum':
    //     const provider = new ethers.providers.JsonRpcProvider(ForceBridgeCore.config.eth.rpcUrl);
    //     txId = (await provider.sendTransaction(ethPayload.signedTransaction)).hash;
    //     break;
    //   default:
    //     Promise.reject(new Error('not yet'));
    // }
    const txId = '00';
    return { txId: txId };
  }

  async getBridgeTransactionStatus(payload): Promise<any> {
    const network = payload.network;
    const txId = payload.txId;
    let status;
    switch (network) {
      case 'Ethereum': {
        const provider = new ethers.providers.JsonRpcProvider(ForceBridgeCore.config.eth.rpcUrl);
        const receipt = await provider.getTransactionReceipt(txId);
        if (receipt == null) {
          status = 'Pending';
          break;
        }
        if (receipt.status == 1) {
          status = 'Failed';
          break;
        } else {
          status = 'Successful';
          break;
        }
      }
      default:
        Promise.reject(new Error('not yet'));
    }
  }

  async getBridgeInNervosBridgeFee(
    payload: GetBridgeInNervosBridgeFeePayload,
  ): Promise<GetBridgeInNervosBridgeFeeResponse> {
    switch (payload.network) {
      case 'Ethereum': {
        checkETHAmount(payload.xchainAssetIdent, payload.amount);

        const asset = new EthAsset(payload.xchainAssetIdent);
        const bridgeFee = asset.getBridgeFee('in');
        return {
          fee: {
            network: 'Nervos',
            ident: getTokenShadowIdent('Ethereum', payload.xchainAssetIdent),
            amount: bridgeFee,
          },
        };
      }
      default:
        throw new Error('invalid bridge chain type');
    }
  }

  async getBridgeOutNervosBridgeFee(
    payload: GetBridgeOutNervosBridgeFeePayload,
  ): Promise<GetBridgeOutNervosBridgeFeeResponse> {
    switch (payload.network) {
      case 'Ethereum': {
        checkETHAmount(payload.xchainAssetIdent, payload.amount);

        const asset = new EthAsset(payload.xchainAssetIdent);
        const bridgeFee = asset.getBridgeFee('out');
        return {
          fee: {
            network: 'Ethereum',
            ident: payload.xchainAssetIdent,
            amount: bridgeFee,
          },
        };
      }
      default:
        throw new Error('invalid bridge chain type');
    }
  }

  async getBridgeTransactionSummaries(
    payload: GetBridgeTransactionSummariesPayload<XChainNetWork>,
  ): Promise<TransactionSummaryWithStatus[]> {
    const XChainNetwork = payload.network;
    const userAddress = payload.user.ident;
    const addressType = payload.user.network;
    const assetName = payload.xchainAssetIdent;
    let dbHandler: IQuery;

    switch (XChainNetwork) {
      case 'Bitcoin':
        dbHandler = new BtcDb(this.connection);
        break;
      case 'Ethereum':
        dbHandler = new EthDb(this.connection);
        break;
      case 'EOS':
        dbHandler = new EosDb(this.connection);
        break;
      case 'Tron':
        dbHandler = new TronDb(this.connection);
        break;
      default:
        throw new Error('invalid bridge chain type');
    }
    logger.info(
      `XChainNetwork :  ${XChainNetwork}, token Asset ${assetName} address type ${addressType} , userAddress:  ${userAddress}`,
    );
    let lockRecords: LockRecord[];
    let unlockRecords: UnlockRecord[];
    switch (addressType) {
      case 'Bitcoin':
      case 'EOS':
      case 'Ethereum':
      case 'Tron':
        lockRecords = await dbHandler.getLockRecordsByXChainAddress(userAddress, assetName);
        unlockRecords = await dbHandler.getUnlockRecordsByXChainAddress(userAddress, assetName);
        break;
      case 'Nervos':
        {
          lockRecords = await dbHandler.getLockRecordsByCkbAddress(userAddress, assetName);
          unlockRecords = await dbHandler.getUnlockRecordsByCkbAddress(userAddress, assetName);
        }
        break;
      default:
        throw new Error('invalid address chain type');
    }

    const result: TransactionSummaryWithStatus[] = [];
    lockRecords.forEach((lockRecord) => {
      result.push(transferDbRecordToResponse(XChainNetwork, lockRecord));
    });
    unlockRecords.forEach((unlockRecord) => {
      result.push(transferDbRecordToResponse(XChainNetwork, unlockRecord));
    });
    // Todo: add paging
    return result;
  }
  async getAssetList(payload): Promise<any> {
    const whiteListAssets = ForceBridgeCore.config.eth.assetWhiteList;
    const assetList = whiteListAssets.map((asset) => {
      return {
        network: 'Ethereum',
        ident: asset.address,
        info: {
          decimals: asset.decimal,
          name: asset.name,
          symbol: asset.symbol,
          logoURI: asset.logoURI,
          shadow: { network: 'Nervos', ident: getTokenShadowIdent('Ethereum', asset.address) },
        },
      };
    });
    const shadowAssetList = assetList.map((asset) => {
      return {
        network: 'Nervos',
        ident: asset.info.shadow.ident,
        info: {
          decimals: asset.info.decimals,
          name: 'ck' + asset.info.name,
          symbol: 'ck' + asset.info.name,
          logoURI: asset.info.logoURI,
          shadow: { network: 'Ethereum', ident: asset.ident },
        },
      };
    });
    return assetList.concat(shadowAssetList);
  }
  async getBalance(payload: GetBalancePayload): Promise<GetBalanceResponse> {
    const balanceFutures = [];
    for (const value of payload) {
      const assetFut = this.getAccountBalance(value);
      balanceFutures.push(assetFut);
    }
    return await Promise.all(balanceFutures);
  }
  async getAccountBalance(value: BalancePayload): Promise<AssetType> {
    let balance: string;
    switch (value.network) {
      case 'Ethereum': {
        const tokenAddress = value.assetIdent;
        const userAddress = value.userIdent;
        if (tokenAddress === '0x0000000000000000000000000000000000000000') {
          const eth_amount = await this.web3.eth.getBalance(userAddress);
          balance = eth_amount.toString();
        } else {
          const TokenContract = new this.web3.eth.Contract(minERC20ABI as AbiItem[], tokenAddress);
          const erc20_amount = await TokenContract.methods.balanceOf(userAddress).call();
          balance = erc20_amount.toString();
        }
        logger.debug(`balance of address: ${userAddress} on ETH is ${balance}`);
        break;
      }

      case 'Bitcoin': {
        const rpcClient = new RPCClient(ForceBridgeCore.config.btc.clientParams);
        const liveUtxos: IBalance = await rpcClient.scantxoutset({
          action: 'start',
          scanobjects: [`addr(${value.userIdent})`],
        });
        logger.debug(`BalanceOf address:${value.userIdent} on BTC is ${liveUtxos.total_amount} btc`);
        balance = bitcore.Unit.fromBTC(liveUtxos.total_amount).toSatoshis();
        break;
      }

      case 'Nervos': {
        const userScript = ForceBridgeCore.ckb.utils.addressToScript(value.userIdent);
        const sudtType = {
          codeHash: ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash,
          hashType: ForceBridgeCore.config.ckb.deps.sudtType.script.hashType,
          args: value.assetIdent,
        };
        const collector = new IndexerCollector(ForceBridgeCore.ckbIndexer);
        const sudt_amount = await collector.getSUDTBalance(
          new Script(sudtType.codeHash, sudtType.args, sudtType.hashType),
          new Script(userScript.codeHash, userScript.args, userScript.hashType as HashType),
        );
        balance = sudt_amount.toString(0);
        break;
      }

      case 'EOS':
        // Todo: add EOS Balance query
        break;
      case 'Tron':
        // Todo: add Tron Balance query
        // const tronWeb = new TronWeb({ fullHost: ForceBridgeCore.config.tron.tronGridUrl });
        // const accountInfo = await tronWeb.trx.getAccount(value.userIdent);
        // balance = JSON.stringify(accountInfo,null,2);
        break;
    }
    return {
      network: value.network,
      ident: value.assetIdent,
      amount: balance,
    };
  }
}

function transferDbRecordToResponse(
  XChainNetwork: XChainNetWork,
  record: LockRecord | UnlockRecord,
): TransactionSummaryWithStatus {
  let bridgeTxRecord: TransactionSummary;
  if ('lock_hash' in record) {
    const confirmStatus = record.lock_confirm_status === 'confirmed' ? 'confirmed' : record.lock_confirm_number;
    bridgeTxRecord = {
      txSummary: {
        fromAsset: {
          network: XChainNetwork,
          ident: record.asset,
          amount: record.lock_amount,
        },
        toAsset: {
          network: 'Nervos',
          ident: getTokenShadowIdent(XChainNetwork, record.asset),
          amount: new Amount(record.lock_amount, 0).sub(new Amount(record.bridge_fee, 0)).toString(0),
        },
        sender: record.sender,
        recipient: record.recipient,
        fromTransaction: {
          txId: record.lock_hash,
          timestamp: record.lock_time,
          confirmStatus: confirmStatus,
        },
      },
    };
    if (record.mint_hash) {
      bridgeTxRecord.txSummary.toTransaction = { txId: record.mint_hash, timestamp: record.mint_time };
    }
  } else if ('burn_hash' in record) {
    const confirmStatus = record.burn_confirm_status === 'confirmed' ? 'confirmed' : record.burn_confirm_number;
    bridgeTxRecord = {
      txSummary: {
        fromAsset: {
          network: 'Nervos',
          ident: getTokenShadowIdent(XChainNetwork, record.asset),
          amount: record.burn_amount,
        },
        toAsset: {
          network: XChainNetwork,
          ident: record.asset,
          amount: new Amount(record.burn_amount, 0).sub(new Amount(record.bridge_fee, 0)).toString(0),
        },
        sender: record.sender,
        recipient: record.recipient,
        fromTransaction: {
          txId: record.burn_hash,
          timestamp: record.burn_time,
          confirmStatus: confirmStatus,
        },
      },
    };
    if (record.unlock_hash) {
      bridgeTxRecord.txSummary.toTransaction = { txId: record.unlock_hash, timestamp: record.unlock_time };
    }
  } else {
    throw new Error(`the params record ${JSON.stringify(record, null, 2)} is unexpect`);
  }
  let txSummaryWithStatus: TransactionSummaryWithStatus;
  switch (record.status) {
    case 'todo':
    case 'pending':
      txSummaryWithStatus = { txSummary: bridgeTxRecord.txSummary, status: BridgeTransactionStatus.Pending };
      break;
    case 'success':
      txSummaryWithStatus = { txSummary: bridgeTxRecord.txSummary, status: BridgeTransactionStatus.Successful };
      break;
    case 'error':
      txSummaryWithStatus = {
        txSummary: bridgeTxRecord.txSummary,
        message: record.message,
        status: BridgeTransactionStatus.Failed,
      };
      break;
    default:
      throw new Error(`${record.status} which mean the tx status is unexpect`);
  }
  return txSummaryWithStatus;
}

function getTokenShadowIdent(XChainNetwork: XChainNetWork, XChainToken: string): string {
  const ownLockHash = getOwnLockHash(ForceBridgeCore.config.ckb.multisigScript);
  let asset: Asset;
  switch (XChainNetwork) {
    case 'Bitcoin':
      asset = new BtcAsset('btc', ownLockHash);
      break;
    case 'EOS':
      asset = new EosAsset(XChainToken, ownLockHash);
      break;
    case 'Ethereum':
      asset = new EthAsset(XChainToken, ownLockHash);
      break;
    case 'Tron':
      asset = new TronAsset(XChainToken, ownLockHash);
      break;
    default:
      logger.warn(`chain type is ${XChainNetwork} which not support yet.`);
      return;
  }
  const bridgeCellLockscript = {
    codeHash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
    hashType: ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
    args: asset.toBridgeLockscriptArgs(),
  };
  return ForceBridgeCore.ckb.utils.scriptToHash(<CKBComponents.Script>bridgeCellLockscript);
}

function checkETHAmount(assetIdent, amount) {
  const asset = new EthAsset(assetIdent);
  const minimalAmount = asset.getMinimalAmount();
  const assetInfo = ForceBridgeCore.config.eth.assetWhiteList.find((asset) => asset.address === assetIdent);
  if (!assetInfo) throw new Error('invalid asset');
  const humanizeMinimalAmount = new BigNumber(minimalAmount).times(10 ** -assetInfo.decimal).toString();
  if (new Amount(amount, 0).lt(new Amount(minimalAmount, 0)))
    throw new Error(`minimal bridge amount is ${humanizeMinimalAmount} ${assetInfo.symbol}`);
}
