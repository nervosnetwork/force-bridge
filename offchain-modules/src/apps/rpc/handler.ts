import { CkbTxGenerator } from '@force-bridge/ckb/tx-helper/generator';
import { IndexerCollector } from '@force-bridge/ckb/tx-helper/collector';
import { Asset, BtcAsset, ChainType, EosAsset, EthAsset, TronAsset } from '@force-bridge/ckb/model/asset';
import { Amount, Script } from '@lay2/pw-core';
import { API, NetworkBase, NetworkTypes } from './types';
import { ForceBridgeCore } from '@force-bridge/core';
import { logger } from '@force-bridge/utils/logger';
import bitcore from 'bitcore-lib';
import { ethers } from 'ethers';
import { abi } from '@force-bridge/xchain/eth/abi/ForceBridge.json';
import { stringToUint8Array } from '@force-bridge/utils';
import {
  BridgeTransactionStatus,
  GetBalancePayload,
  GetBalanceResponse,
  GetBridgeTransactionSummariesPayload,
  TransactionSummary,
  TransactionSummaryWithStatus,
} from './types/apiv1';
import { IQuery, LockRecord, UnlockRecord } from '@force-bridge/db/model';
import { EthDb, TronDb } from '@force-bridge/db';
import { EosDb } from '@force-bridge/db/eos';
import { BtcDb } from '@force-bridge/db/btc';
import { RPCClient } from 'rpc-bitcoin';
import { IBalance } from '@force-bridge/xchain/btc';
import { Account } from '@force-bridge/ckb/model/accounts';

const TronWeb = require('tronweb');

export class ForceBridgeAPIV1Handler implements API.ForceBridgeAPIV1 {
  connection;
  constructor(conn) {
    this.connection = conn;
  }

  async generateBridgeInNervosTransaction<T extends NetworkTypes>(
    payload: API.GenerateBridgeInTransactionPayload,
  ): Promise<API.GenerateTransactionResponse<T>> {
    logger.info('generateBridgeInNervosTransaction ', payload);

    const sender = payload.sender;

    const network = payload.asset.network;
    let tx;
    switch (network) {
      case 'Ethereum':
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
    const bridgeFee = {
      network: network,
      ident: payload.asset.ident,
      amount: '1',
    };
    return {
      network: network,
      rawTransaction: tx,
      bridgeFee: bridgeFee,
    };
  }

  async generateBridgeOutNervosTransaction<T extends NetworkTypes>(
    payload: API.GenerateBridgeOutNervosTransactionPayload,
  ): Promise<API.GenerateTransactionResponse<T>> {
    logger.info('generateBridgeOutNervosTransaction ', payload);
    const fromLockscript = ForceBridgeCore.ckb.utils.addressToScript(payload.sender);
    const ownLockHash = ForceBridgeCore.config.ckb.ownerLockHash;

    const network = payload.network;
    const assetName = payload.asset;

    let asset;
    switch (network) {
      case 'Ethereum':
        asset = new EthAsset(assetName, ownLockHash);
        break;
      case 'Tron':
        asset = new TronAsset(assetName, ownLockHash);
        break;
      default:
        //TODO: add other chains
        Promise.reject(new Error('invalid chain type'));
    }

    const amount = payload.amount;

    const script = Script.fromRPC({
      code_hash: fromLockscript.codeHash,
      args: fromLockscript.args,
      hash_type: fromLockscript.hashType,
    });
    const ckbTxGenerator = new CkbTxGenerator(ForceBridgeCore.ckb, new IndexerCollector(ForceBridgeCore.indexer));
    const burnTx = await ckbTxGenerator.burn(script, payload.recipient, asset, new Amount(amount, 0));
    return {
      network: 'Nervos',
      rawTransaction: burnTx,
      bridgeFee: { network: 'Nervos', ident: 'ckb', amount: '0' },
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
      case 'Ethereum':
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
      default:
        Promise.reject(new Error('not yet'));
    }
  }

  async getBridgeTransactionSummaries(
    payload: GetBridgeTransactionSummariesPayload,
  ): Promise<TransactionSummaryWithStatus[]> {
    const XChainNetwork = payload.network;
    const ckbAddress = payload.userIdent;
    const ckbLockScript = ForceBridgeCore.ckb.utils.addressToScript(ckbAddress);
    const ckbLockHash = ForceBridgeCore.ckb.utils.scriptToHash(<CKBComponents.Script>ckbLockScript);
    const assetName = payload.assetIdent;
    let dbHandler: IQuery;
    logger.debug(`XChainNetwork :  ${XChainNetwork}, userAddress:  ${ckbAddress}`);
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
        throw new Error('invalid chain type');
    }

    // only query the txs which status is success or pending
    const lockRecords = await dbHandler.getLockRecordsByUser(ckbAddress);
    const unlockRecords = await dbHandler.getUnlockRecordsByUser(ckbLockHash);

    const result: TransactionSummaryWithStatus[] = [];
    lockRecords.forEach((lockRecord) => {
      const txSummaryWithStatus = transferDbRecordToResponse(XChainNetwork, lockRecord);
      result.push(txSummaryWithStatus);
    });
    unlockRecords.forEach((unlockRecord) => {
      const txSummaryWithStatus = transferDbRecordToResponse(XChainNetwork, unlockRecord);
      result.push(txSummaryWithStatus);
    });
    // Todo: add paging
    return result;
  }
  async getAssetList(payload): Promise<any> {
    const eth_address = '0x0000000000000000000000000000000000000000';
    const dai_address = '0x7Af456bf0065aADAB2E6BEc6DaD3731899550b84';
    const usdt_address = '0x74a3dbd5831f45CD0F3002Bb87a59B7C15b1B5E6';
    const usdc_address = '0x265566D4365d80152515E800ca39424300374A83';

    const eth_ident = await getTokenShadowIdent(ChainType.ETH, eth_address);
    const dai_ident = await getTokenShadowIdent(ChainType.ETH, dai_address);
    const usdt_ident = await getTokenShadowIdent(ChainType.ETH, usdt_address);
    const usdc_ident = await getTokenShadowIdent(ChainType.ETH, usdc_address);

    const info = [
      {
        network: 'Ethereum',
        ident: eth_address,
        info: {
          decimals: 18,
          name: 'ETH',
          symbol: 'Eth',
          logoURI: 'https://cryptologos.cc/logos/ethereum-eth-logo.svg?v=002',
          shadow: { network: 'Nervos', ident: eth_ident },
        },
      },
      {
        network: 'Nervos',
        ident: eth_ident,
        info: {
          decimals: 18,
          name: 'ckETH',
          symbol: 'ckEth',
          logoURI: 'https://cryptologos.cc/logos/ethereum-eth-logo.svg?v=002',
          shadow: { network: 'Ethereum', ident: eth_address },
        },
      },
      {
        network: 'Ethereum',
        ident: dai_address,
        info: {
          decimals: 18,
          name: 'DAI',
          symbol: 'Dai',
          logoURI: 'https://cryptologos.cc/logos/single-collateral-dai-sai-logo.svg?v=002',
          shadow: { network: 'Nervos', ident: dai_ident },
        },
      },
      {
        network: 'Nervos',
        ident: dai_ident,
        info: {
          decimals: 18,
          name: 'ckDAI',
          symbol: 'ckDai',
          logoURI: 'https://cryptologos.cc/logos/single-collateral-dai-sai-logo.svg?v=002',
          shadow: { network: 'Ethereum', ident: dai_address },
        },
      },
      {
        network: 'Ethereum',
        ident: usdt_address,
        info: {
          decimals: 18,
          name: 'USDT',
          symbol: 'Usdt',
          logoURI: 'https://cryptologos.cc/logos/tether-usdt-logo.svg?v=002',
          shadow: { network: 'Nervos', ident: usdt_ident },
        },
      },
      {
        network: 'Nervos',
        ident: usdt_ident,
        info: {
          decimals: 18,
          name: 'ckUSDT',
          symbol: 'ckUsdt',
          logoURI: 'https://cryptologos.cc/logos/tether-usdt-logo.svg?v=002',
          shadow: { network: 'Ethereum', ident: usdt_address },
        },
      },
      {
        network: 'Ethereum',
        ident: usdc_address,
        info: {
          decimals: 18,
          name: 'USDC',
          symbol: 'Usdc',
          logoURI: 'https://cryptologos.cc/logos/usd-coin-usdc-logo.svg?v=002',
          shadow: { network: 'Nervos', ident: usdc_ident },
        },
      },
      {
        network: 'Nervos',
        ident: usdc_ident,
        info: {
          decimals: 18,
          name: 'ckUSDC',
          symbol: 'ckUsdc',
          logoURI: 'https://cryptologos.cc/logos/usd-coin-usdc-logo.svg?v=002',
          shadow: { network: 'Ethereum', ident: usdc_address },
        },
      },
    ];
    return info;
  }
  async getBalance(payload: GetBalancePayload): Promise<GetBalanceResponse> {
    const result: GetBalanceResponse = [];
    for (const value of payload) {
      let balance: string;
      switch (value.network) {
        case 'Ethereum':
          const provider = new ethers.providers.JsonRpcProvider(ForceBridgeCore.config.eth.rpcUrl);
          const tokenAddress = value.assetIdent;
          const userAddress = value.userIdent;
          if (tokenAddress === ethers.constants.AddressZero) {
            const eth_amount = await provider.getBalance(userAddress);
            balance = eth_amount.toString();
          } else {
            const erc20ABI = [
              'function name() view returns (string)',
              'function symbol() view returns (string)',
              'function balanceOf(address) view returns (uint)',
              'function transfer(address to, uint amount)',
              'event Transfer(address indexed from, address indexed to, uint amount)',
            ];
            const erc20Contract = new ethers.Contract(tokenAddress, erc20ABI, provider);
            const erc20Amount = await erc20Contract.balanceOf(userAddress);
            balance = erc20Amount.toString();
          }
          console.log(`balance of address: ${userAddress} on ETH is ${balance}`);
          break;
        case 'Bitcoin':
          const rpcClient = new RPCClient(ForceBridgeCore.config.btc.clientParams);
          const liveUtxos: IBalance = await rpcClient.scantxoutset({
            action: 'start',
            scanobjects: [`addr(${value.userIdent})`],
          });
          console.log(`BalanceOf address:${value.userIdent} on BTC is ${liveUtxos.total_amount} btc`);
          balance = bitcore.Unit.fromBTC(liveUtxos.total_amount).toSatoshis();
          break;
        case 'Nervos':
          const userScript = ForceBridgeCore.ckb.utils.addressToScript(value.userIdent);
          const sudtType = {
            codeHash: ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash,
            hashType: ForceBridgeCore.config.ckb.deps.sudtType.script.hashType,
            args: value.assetIdent,
          };
          const collector = new IndexerCollector(ForceBridgeCore.indexer);
          const sudt_amount = await collector.getSUDTBalance(
            new Script(sudtType.codeHash, sudtType.args, sudtType.hashType),
            new Script(userScript.codeHash, userScript.args, userScript.hashType),
          );
          balance = sudt_amount.toString(0);
          break;
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
      result.push({
        network: value.network,
        ident: value.assetIdent,
        amount: balance,
      });
    }
    return result;
  }
}

function transferDbRecordToResponse(
  XChainNetwork: string,
  record: LockRecord | UnlockRecord,
): TransactionSummaryWithStatus {
  let bridgeTxRecord: TransactionSummary;
  if ('lock_hash' in record) {
    bridgeTxRecord = {
      txSummary: {
        fromAsset: {
          network: XChainNetwork,
          ident: record.asset,
          amount: record.lock_amount,
        },
        toAsset: {
          network: 'Nervos',
          ident: record.asset,
          amount: record.mint_amount,
        },
        fromTransaction: { txId: record.lock_hash, timestamp: record.lock_time },
        toTransaction: { txId: record.mint_hash, timestamp: record.mint_time },
      },
    };
  } else if ('burn_hash' in record) {
    bridgeTxRecord = {
      txSummary: {
        fromAsset: {
          network: 'Nervos',
          ident: record.asset,
          amount: record.burn_amount,
        },
        toAsset: {
          network: XChainNetwork,
          ident: record.asset,
          amount: record.unlock_amount,
        },
        fromTransaction: { txId: record.burn_hash, timestamp: record.burn_time },
        toTransaction: { txId: record.unlock_hash, timestamp: record.unlock_time },
      },
    };
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

function getTokenShadowIdent(chainType: ChainType, XChainToken: string): Promise<string> {
  const ownLockHash = ForceBridgeCore.config.ckb.ownerLockHash;
  let asset: Asset;
  switch (chainType) {
    case ChainType.BTC:
      asset = new BtcAsset('btc', ownLockHash);
      break;
    case ChainType.EOS:
      asset = new EosAsset(XChainToken, ownLockHash);
      break;
    case ChainType.ETH:
      asset = new EthAsset(XChainToken, ownLockHash);
      break;
    case ChainType.TRON:
      asset = new TronAsset(XChainToken, ownLockHash);
      break;
    default:
      logger.warn(`chain type is ${chainType} which not support yet.`);
      return;
  }
  const bridgeCellLockscript = {
    codeHash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
    hashType: ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
    args: asset.toBridgeLockscriptArgs(),
  };
  const sudtArgs = ForceBridgeCore.ckb.utils.scriptToHash(<CKBComponents.Script>bridgeCellLockscript);
  return sudtArgs;
}
