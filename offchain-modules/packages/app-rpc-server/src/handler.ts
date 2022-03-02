import { parseAddress } from '@ckb-lumos/helpers';
import { Asset, BtcAsset, ChainType, EosAsset, EthAsset, TronAsset } from '@force-bridge/x/dist/ckb/model/asset';
import { NervosAsset } from '@force-bridge/x/dist/ckb/model/nervos-asset';
import { IndexerCollector } from '@force-bridge/x/dist/ckb/tx-helper/collector';
import { CkbTxGenerator } from '@force-bridge/x/dist/ckb/tx-helper/generator';
import { getOwnerTypeHash } from '@force-bridge/x/dist/ckb/tx-helper/multisig/multisig_helper';
import { CKB_TYPESCRIPT_HASH } from '@force-bridge/x/dist/config';
import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { CkbDb, EthDb, TronDb } from '@force-bridge/x/dist/db';
import { BtcDb } from '@force-bridge/x/dist/db/btc';
import { EosDb } from '@force-bridge/x/dist/db/eos';
import { IQuery, LockRecord, UnlockRecord } from '@force-bridge/x/dist/db/model';
import { stringToUint8Array } from '@force-bridge/x/dist/utils';
import { logger } from '@force-bridge/x/dist/utils/logger';
import { IBalance } from '@force-bridge/x/dist/xchain/btc';
import { abi } from '@force-bridge/x/dist/xchain/eth/abi/ForceBridge.json';
import { checkLock } from '@force-bridge/x/dist/xchain/eth/check';
import { Amount } from '@lay2/pw-core';
import { BigNumber } from 'bignumber.js';
import bitcore from 'bitcore-lib';
import { ethers } from 'ethers';
import { RPCClient } from 'rpc-bitcoin';
import { Connection } from 'typeorm';
import Web3 from 'web3';
import { AbiItem } from 'web3-utils';
import { Factory as BurnHandlerFactory } from './handler/burn/factory';
import { Factory as SummaryResponseFactory } from './response/summary/factory';
import { API, AssetType, NetworkTypes, RequiredAsset } from './types';
import {
  BalancePayload,
  BlockChainNetWork,
  GenerateBridgeNervosToXchainBurnTxPayload,
  GenerateBridgeNervosToXchainLockTxPayload,
  GenerateTransactionResponse,
  GetBalancePayload,
  GetBalanceResponse,
  GetBridgeInNervosBridgeFeePayload,
  GetBridgeInNervosBridgeFeeResponse,
  GetBridgeNervosToXchainBurnBridgeFeePayload,
  GetBridgeNervosToXchainBurnBridgeFeeResponse,
  GetBridgeNervosToXchainLockBridgeFeePayload,
  GetBridgeNervosToXchainLockBridgeFeeResponse,
  GetBridgeNervosToXchainTxSummariesPayload,
  GetBridgeOutNervosBridgeFeePayload,
  GetBridgeOutNervosBridgeFeeResponse,
  GetBridgeTransactionSummariesPayload,
  GetMinimalBridgeAmountPayload,
  GetMinimalBridgeAmountResponse,
  TransactionSummaryWithStatus,
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
    logger.info(`generateBridgeInNervosTransaction, payload: ${JSON.stringify(payload)}`);

    checkCKBAddress(payload.recipient);

    const network = payload.asset.network;
    let tx;
    switch (network) {
      case 'Ethereum': {
        const sudtExtraData = '0x';
        const checkRes = checkLock(payload.asset.amount, payload.asset.ident, payload.recipient, sudtExtraData);
        logger.info(`checkLock: ${JSON.stringify({ payload, checkRes })}`);
        if (checkRes !== '') {
          throw new Error(checkRes);
        }
        const provider = new ethers.providers.JsonRpcProvider(ForceBridgeCore.config.eth.rpcUrl);
        const bridgeContractAddr = ForceBridgeCore.config.eth.contractAddress;
        const bridge = new ethers.Contract(bridgeContractAddr, abi, provider);
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
        throw new Error('invalid chain type');
    }
    return {
      network: network,
      rawTransaction: tx,
    };
  }

  async generateBridgeOutNervosTransaction<T extends NetworkTypes>(
    payload: API.GenerateBridgeOutNervosTransactionPayload,
  ): Promise<API.GenerateTransactionResponse<T>> {
    logger.info(`generateBridgeOutNervosTransaction, payload: ${JSON.stringify(payload)}`);
    checkCKBAddress(payload.sender);
    const fromLockscript = parseAddress(payload.sender);
    const ownerTypeHash = getOwnerTypeHash();

    const network = payload.network;
    const assetName = payload.asset;
    const amount = payload.amount;

    let asset;
    switch (network) {
      case 'Ethereum':
        checkETHAmount(assetName, amount);
        checkETHAddress(payload.recipient);
        await checkLockEthAddr(payload.recipient);
        asset = new EthAsset(assetName, ownerTypeHash);
        break;
      case 'Tron':
        asset = new TronAsset(assetName, ownerTypeHash);
        break;
      default:
        //TODO: add other chains
        throw new Error('invalid chain type');
    }

    const ckbTxGenerator = new CkbTxGenerator(
      ForceBridgeCore.config.ckb.ckbRpcUrl,
      ForceBridgeCore.config.ckb.ckbIndexerUrl,
    );
    const burnTx = await ckbTxGenerator.burn(fromLockscript, payload.recipient, asset, BigInt(amount));
    return {
      network: 'Nervos',
      rawTransaction: burnTx,
    };
  }

  async sendSignedTransaction(): Promise<API.TransactionIdent> {
    throw new Error('not implemented');
  }

  async getBridgeTransactionStatus(
    _payload: API.GetBridgeTransactionStatusPayload,
  ): Promise<API.GetBridgeTransactionStatusResponse> {
    throw new Error('not implemented');
  }

  async getMinimalBridgeAmount(payload: GetMinimalBridgeAmountPayload): Promise<GetMinimalBridgeAmountResponse> {
    switch (payload.network) {
      case 'Ethereum': {
        checkETHAddress(payload.xchainAssetIdent);
        const asset = new EthAsset(payload.xchainAssetIdent);
        return {
          minimalAmount: asset.getMinimalAmount(),
        };
      }
      case 'Nervos': {
        const asset = new NervosAsset(payload.xchainAssetIdent);
        if (!payload.targetChain || payload.targetChain !== 'Ethereum')
          throw new Error('only support targeChain Ethereum');
        return {
          minimalAmount: asset.getMinimalAmount(ChainType.ETH),
        };
      }
      default:
        throw new Error('invalid bridge chain type');
    }
  }

  async getBridgeInNervosBridgeFee(
    payload: GetBridgeInNervosBridgeFeePayload,
  ): Promise<GetBridgeInNervosBridgeFeeResponse> {
    switch (payload.network) {
      case 'Ethereum': {
        checkETHAddress(payload.xchainAssetIdent);
        checkETHAmount(payload.xchainAssetIdent, payload.amount);

        const asset = new EthAsset(payload.xchainAssetIdent);
        const bridgeFee = asset.getBridgeFee('in');
        return {
          fee: {
            network: 'Nervos',
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            ident: getTokenShadowIdent('Ethereum', payload.xchainAssetIdent)!,
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
        checkETHAddress(payload.xchainAssetIdent);
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

  async getBridgeNervosToXchainLockBridgeFee(
    payload: GetBridgeNervosToXchainLockBridgeFeePayload,
  ): Promise<GetBridgeNervosToXchainLockBridgeFeeResponse> {
    switch (payload.xchain) {
      case 'Ethereum': {
        checkCKBAddress(payload.typescriptHash);
        checkCKBAmount(payload.typescriptHash, payload.amount);

        const asset = new NervosAsset(payload.typescriptHash);
        const bridgeFee = asset.getBridgeFee('lock', ChainType.ETH);
        return {
          amount: bridgeFee,
        };
      }
      default:
        throw new Error('invalid bridge chain type');
    }
  }

  async getBridgeNervosToXchainBurnBridgeFee(
    payload: GetBridgeNervosToXchainBurnBridgeFeePayload,
  ): Promise<GetBridgeNervosToXchainBurnBridgeFeeResponse> {
    switch (payload.xchain) {
      case 'Ethereum': {
        checkCKBAddress(payload.typescriptHash);
        checkCKBAmount(payload.typescriptHash, payload.amount);

        const asset = new NervosAsset(payload.typescriptHash);
        const bridgeFee = asset.getBridgeFee('burn', ChainType.ETH);
        return {
          xchain: payload.xchain,
          amount: bridgeFee,
        };
      }
      default:
        throw new Error('invalid bridge chain type');
    }
  }

  async getBridgeTransactionSummaries(
    payload: GetBridgeTransactionSummariesPayload<BlockChainNetWork>,
  ): Promise<TransactionSummaryWithStatus[]> {
    const network = payload.network;
    const userAddress = payload.user.ident;
    const addressType = payload.user.network;
    const assetName = payload.xchainAssetIdent;
    let dbHandler: IQuery;

    switch (network) {
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
      case 'Nervos':
        dbHandler = new CkbDb(this.connection);
        break;
      default:
        throw new Error('invalid bridge chain type');
    }
    logger.info(
      `XChainNetwork :  ${network}, token Asset ${assetName} address type ${addressType} , userAddress:  ${userAddress}`,
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
      result.push(SummaryResponseFactory.fromNetwrok(network).response(lockRecord));
    });
    unlockRecords.forEach((unlockRecord) => {
      result.push(SummaryResponseFactory.fromNetwrok(network).response(unlockRecord));
    });
    // Todo: add paging
    return result;
  }

  async getAssetList(_name?: unknown): Promise<RequiredAsset<'info'>[]> {
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
    }) as RequiredAsset<'info'>[];

    const nervosWhiteListAssets = ForceBridgeCore.config.eth.nervosAssetWhiteList;
    const nervosAssetList = nervosWhiteListAssets.map((asset) => {
      return {
        network: 'Nervos',
        ident: asset.typescript ? asset.typescript.args : CKB_TYPESCRIPT_HASH,
        info: {
          decimals: asset.decimal,
          name: asset.name,
          symbol: asset.symbol,
          logoURI: asset.logoURI,
          shadow: { network: 'Ethereum', ident: asset.xchainTokenAddress },
        },
      };
    }) as RequiredAsset<'info'>[];

    return assetList.concat(nervosAssetList);
  }

  async getBalance(payload: GetBalancePayload): Promise<GetBalanceResponse> {
    const balanceFutures: Promise<AssetType>[] = [];
    for (const value of payload) {
      const assetFut = this.getAccountBalance(value);
      balanceFutures.push(assetFut);
    }
    return (await Promise.all(balanceFutures)) as unknown as Promise<GetBalanceResponse>;
  }

  async getAccountBalance(value: BalancePayload): Promise<AssetType> {
    let balance: string;
    switch (value.network) {
      case 'Ethereum': {
        const tokenAddress = value.assetIdent;
        const userAddress = value.userIdent;
        checkETHAddress(tokenAddress);
        checkETHAddress(userAddress);
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
        const collector = new IndexerCollector(ForceBridgeCore.ckbIndexer);
        const userScript = parseAddress(value.userIdent);
        if (value.assetIdent === CKB_TYPESCRIPT_HASH) {
          const ckb_amount = await collector.getBalance(userScript);
          balance = ckb_amount.toString();
        } else {
          const sudtType = {
            code_hash: ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash,
            hash_type: ForceBridgeCore.config.ckb.deps.sudtType.script.hashType,
            args: value.assetIdent,
          };
          const sudt_amount = await collector.getSUDTBalance(sudtType, userScript);
          balance = sudt_amount.toString();
        }
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
      default:
        throw new Error('invalid chain type');
    }
    return {
      network: value.network,
      ident: value.assetIdent,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      amount: balance!,
    };
  }

  async getBridgeConfig(): Promise<API.GetBridgeConfigResponse> {
    const ethConfig = ForceBridgeCore.config.eth;

    return {
      nervos: {
        network: ForceBridgeCore.config.common.network,
        confirmNumber: ForceBridgeCore.config.ckb.confirmNumber,
      },
      xchains: {
        Ethereum: {
          contractAddress: ethConfig.contractAddress,
          confirmNumber: ethConfig.confirmNumber,
        },
      },
    };
  }

  /* Bridge nervos asset to xchain */
  async generateBridgeNervosToXchainLockTx<T extends NetworkTypes>(
    payload: GenerateBridgeNervosToXchainLockTxPayload,
  ): Promise<GenerateTransactionResponse<T>> {
    logger.info(`generateBridgeNervosToXchainLockTx, payload: ${JSON.stringify(payload)}`);
    const { xchain, assetIdent, amount, recipient, sender } = payload;

    checkCKBAddress(sender);
    const senderLockscript = parseAddress(sender);

    switch (xchain) {
      case 'Ethereum': {
        checkETHAddress(recipient);
        await checkLockEthAddr(recipient);
        const nervosAssetInfo = new NervosAsset(assetIdent).getAssetInfo(ChainType.ETH);
        if (!nervosAssetInfo) throw new Error('lock asset not in white list');
        if (BigInt(amount) <= BigInt(nervosAssetInfo.minimalBridgeAmount))
          throw new Error(
            `lock amount should be greater than minimal bridge amount ${nervosAssetInfo.minimalBridgeAmount}`,
          );
        break;
      }

      default:
        throw new Error('unimplement chain type');
    }

    const ckbTxGenerator = new CkbTxGenerator(
      ForceBridgeCore.config.ckb.ckbRpcUrl,
      ForceBridgeCore.config.ckb.ckbIndexerUrl,
    );
    const lockTx = await ckbTxGenerator.lock(senderLockscript, recipient, assetIdent, BigInt(amount), xchain);

    return {
      network: 'Nervos',
      rawTransaction: lockTx,
    };
  }

  async generateBridgeNervosToXchainBurnTx<T extends NetworkTypes>(
    payload: GenerateBridgeNervosToXchainBurnTxPayload,
  ): Promise<GenerateTransactionResponse<T>> {
    return await BurnHandlerFactory.fromChainName(payload.xchain).handle(payload);
  }

  async getBridgeNervosToXchainTxSummaries(
    _payload: GetBridgeNervosToXchainTxSummariesPayload,
  ): Promise<TransactionSummaryWithStatus[]> {
    // TODO
    throw new Error('unimplement');
  }
}

function getTokenShadowIdent(XChainNetwork: BlockChainNetWork, XChainToken: string): string | undefined {
  const ownerTypeHash = getOwnerTypeHash();
  let asset: Asset;
  switch (XChainNetwork) {
    case 'Bitcoin':
      asset = new BtcAsset('btc', ownerTypeHash);
      break;
    case 'EOS':
      asset = new EosAsset(XChainToken, ownerTypeHash);
      break;
    case 'Ethereum':
      asset = new EthAsset(XChainToken, ownerTypeHash);
      break;
    case 'Tron':
      asset = new TronAsset(XChainToken, ownerTypeHash);
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

async function checkLockEthAddr(address: string) {
  if (address === '0x0000000000000000000000000000000000000000') {
    throw new Error('can not unlock to zero address');
  }
  const provider = new ethers.providers.JsonRpcProvider(ForceBridgeCore.config.eth.rpcUrl);
  const getCodeRes = await provider.getCode(address);
  if (getCodeRes !== '0x') {
    throw new Error('can not unlock to contract');
  }
}

function checkETHAddress(address) {
  if (!ethers.utils.isAddress(address) || address.substr(0, 2).toLowerCase() != '0x') {
    throw new Error('invalid eth address');
  }
}

function checkCKBAddress(address) {
  if (address === CKB_TYPESCRIPT_HASH) return;
  try {
    parseAddress(address);
  } catch (e) {
    throw new Error('invalid ckb address');
  }
}

function checkETHAmount(assetIdent, amount) {
  const asset = new EthAsset(assetIdent);
  const minimalAmount = asset.getMinimalAmount();
  const assetInfo = ForceBridgeCore.config.eth.assetWhiteList.find((asset) => asset.address === assetIdent);
  if (!assetInfo) throw new Error('invalid asset');
  const humanizeMinimalAmount = new BigNumber(minimalAmount)
    .times(new BigNumber(10).pow(-assetInfo.decimal))
    .toString();
  if (new Amount(amount, 0).lt(new Amount(minimalAmount, 0)))
    throw new Error(`minimal bridge amount is ${humanizeMinimalAmount} ${assetInfo.symbol}`);
}

function checkCKBAmount(typescriptHash, amount) {
  const asset = new NervosAsset(typescriptHash);
  const minimalAmount = asset.getMinimalAmount(ChainType.ETH);
  const assetInfo = ForceBridgeCore.config.eth.nervosAssetWhiteList.find(
    (asset) => asset.typescriptHash === typescriptHash,
  );
  if (!assetInfo) throw new Error('invalid asset');
  const humanizeMinimalAmount = new BigNumber(minimalAmount)
    .times(new BigNumber(10).pow(-assetInfo.decimal))
    .toString();
  if (new Amount(amount, 0).lt(new Amount(minimalAmount, 0)))
    throw new Error(`minimal bridge amount is ${humanizeMinimalAmount} ${assetInfo.symbol}`);
}
