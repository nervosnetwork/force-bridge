import { core, utils } from '@ckb-lumos/base';
import { serializeMultisigScript } from '@ckb-lumos/common-scripts/lib/secp256k1_blake160_multisig';
import { key } from '@ckb-lumos/hd';
import {
  createTransactionFromSkeleton,
  generateAddress,
  parseAddress,
  sealTransaction,
  TransactionSkeletonType,
} from '@ckb-lumos/helpers';
import { RPC } from '@ckb-lumos/rpc';
import { BigNumber } from 'bignumber.js';
import { normalizers, Reader } from 'ckb-js-toolkit';
import * as lodash from 'lodash';
import { BtcAsset, ChainType, EosAsset, EthAsset, getAsset, TronAsset } from '../ckb/model/asset';
import { NervosAsset } from '../ckb/model/nervos-asset';
import { RecipientCellData } from '../ckb/tx-helper/generated/eth_recipient_cell';
import { ForceBridgeLockscriptArgs } from '../ckb/tx-helper/generated/force_bridge_lockscript';
import { MintWitness } from '../ckb/tx-helper/generated/mint_witness';
import { CkbTxGenerator, MintAssetRecord } from '../ckb/tx-helper/generator';
import { GetTransactionsResult, ScriptType, SearchKey } from '../ckb/tx-helper/indexer';
import { getOwnerTypeHash } from '../ckb/tx-helper/multisig/multisig_helper';
import { getOmniLockMultisigAddress } from '../ckb/tx-helper/multisig/omni-lock';
import { forceBridgeRole } from '../config';
import { ForceBridgeCore } from '../core';
import { CkbDb, KVDb } from '../db';
import { CollectorCkbMint } from '../db/entity/CkbMint';
import {
  CkbLock,
  CkbUnlock,
  EthUnlock,
  ICkbBurn,
  ICkbMint,
  ICkbUnlock,
  IEthUnlock,
  MintedRecord,
  MintedRecords,
  TxConfirmStatus,
  NervosLockAssetTxMetaData,
} from '../db/model';

import { asserts, nonNullable } from '../errors';
import { BridgeMetricSingleton, txTokenInfo } from '../metric/bridge-metric';
import { createAsset, MultiSigMgr } from '../multisig/multisig-mgr';
import {
  asyncSleep,
  foreverPromise,
  fromHexString,
  toHexString,
  transactionSkeletonToJSON,
  uint8ArrayToString,
} from '../utils';
import { logger } from '../utils/logger';
import { getAssetTypeByAsset } from '../xchain/tron/utils';
import Transaction = CKBComponents.Transaction;
import TransactionWithStatus = CKBComponents.TransactionWithStatus;
import { LockMemo } from '../ckb/tx-helper/generated/lock_memo';
import { EthUnlockStatus } from '../db/entity/EthUnlock';
import { secp256k1Blake160Multisig } from '@ckb-lumos/common-scripts';
import { SerializeRcLockWitnessLock } from '../ckb/tx-helper/generated/omni_lock';
import { SerializeWitnessArgs } from '@ckb-lumos/base/lib/core';

const lastHandleCkbBlockKey = 'lastHandleCkbBlock';

export interface CkbTxInfo {
  info: GetTransactionsResult;
  tx: TransactionWithStatus;
}

// CKB handler
// 1. Listen CKB chain to get new burn events.
// 2. Listen database to get new mint events, send tx.
export class CkbHandler {
  private ckb = ForceBridgeCore.ckb;
  private ckbIndexer = ForceBridgeCore.ckbIndexer;
  private rpc: RPC;
  private multisigMgr: MultiSigMgr;
  private lastHandledBlockHeight: number;
  private lastHandledBlockHash: string;
  private startTipBlockHeight: number;
  private readonly todoRoundHandlers: ((ownerTypeHash: string, generator: CkbTxGenerator) => Promise<void>)[];
  private todoRoundIndex: number;

  constructor(private db: CkbDb, private kvDb: KVDb, private role: forceBridgeRole) {
    this.rpc = new RPC(ForceBridgeCore.config.ckb.ckbRpcUrl);
    if (role === 'collector') {
      this.multisigMgr = new MultiSigMgr(
        'CKB',
        ForceBridgeCore.config.ckb.multiSignHosts,
        ForceBridgeCore.config.ckb.multisigScript.M,
      );
    }
    this.todoRoundHandlers = [this.todoMintRecordsHandler, this.todoUnlockRecordsHandler];
    this.todoRoundIndex = 0;
  }

  async setStartTipBlockHeight(): Promise<void> {
    this.startTipBlockHeight = (await this.getTipBlock()).height;
  }

  syncedToStartTipBlockHeight(): boolean {
    return (
      Boolean(this.lastHandledBlockHeight) &&
      Boolean(this.startTipBlockHeight) &&
      this.lastHandledBlockHeight > this.startTipBlockHeight
    );
  }

  async getLastHandledBlock(): Promise<{ blockNumber: number; blockHash: string }> {
    const lastHandledBlock = await this.kvDb.get(lastHandleCkbBlockKey);
    if (!lastHandledBlock) {
      return { blockNumber: 0, blockHash: '' };
    }
    const block = lastHandledBlock.split(',');
    return { blockNumber: parseInt(block[0]), blockHash: block[1] };
  }

  async setLastHandledBlock(blockNumber: number, blockHash: string): Promise<void> {
    this.lastHandledBlockHeight = blockNumber;
    this.lastHandledBlockHash = blockHash;
    await this.kvDb.set(lastHandleCkbBlockKey, `${blockNumber},${blockHash}`);
  }

  getHandledBlock(): { height: number; hash: string } {
    return { height: this.lastHandledBlockHeight, hash: this.lastHandledBlockHash };
  }

  async getTipBlock(): Promise<{ height: number; hash: string }> {
    const tipHeader = await this.ckb.rpc.getTipHeader();
    return { height: Number(tipHeader.number), hash: tipHeader.hash };
  }

  async onCkbBurnConfirmed(confirmedCkbBurns: ICkbBurn[]): Promise<void> {
    if (this.role !== 'collector') return;
    for (const burn of confirmedCkbBurns) {
      logger.info(`CkbHandler onCkbBurnConfirmed burnRecord:${JSON.stringify(burn)}`);
      if (BigInt(burn.amount) <= BigInt(burn.bridgeFee))
        throw new Error('Unexpected error: burn amount less than bridge fee');
      const unlockAmount = (BigInt(burn.amount) - BigInt(burn.bridgeFee)).toString();
      switch (burn.chain) {
        case ChainType.BTC:
          await this.db.createBtcUnlock([
            {
              ckbTxHash: burn.ckbTxHash,
              asset: burn.asset,
              amount: unlockAmount,
              chain: burn.chain,
              recipientAddress: burn.recipientAddress,
            },
          ]);
          break;
        case ChainType.ETH:
          await this.db.createCollectorEthUnlock([
            {
              ckbTxHash: burn.ckbTxHash,
              asset: burn.asset,
              amount: unlockAmount,
              recipientAddress: burn.recipientAddress,
            },
          ]);
          break;
        case ChainType.EOS:
          await this.db.createEosUnlock([
            {
              ckbTxHash: burn.ckbTxHash,
              asset: burn.asset,
              amount: unlockAmount,
              recipientAddress: burn.recipientAddress,
            },
          ]);
          break;
        case ChainType.TRON:
          await this.db.createTronUnlock([
            {
              ckbTxHash: burn.ckbTxHash,
              asset: burn.asset,
              assetType: getAssetTypeByAsset(burn.asset),
              amount: unlockAmount,
              recipientAddress: burn.recipientAddress,
            },
          ]);
          break;
        default:
          throw new Error(`wrong burn chain type: ${burn.chain}`);
      }
    }
  }

  async initLastHandledBlock(): Promise<void> {
    const lastHandledBlock = await this.getLastHandledBlock();
    if (lastHandledBlock.blockNumber !== 0) {
      this.lastHandledBlockHeight = lastHandledBlock.blockNumber;
      this.lastHandledBlockHash = lastHandledBlock.blockHash;
      return;
    }

    const lastHandledBlockHeight = ForceBridgeCore.config.ckb.startBlockHeight;
    if (lastHandledBlockHeight > 0) {
      const lastHandledHead = await this.ckb.rpc.getHeaderByNumber(`0x${lastHandledBlockHeight.toString(16)}`);
      if (lastHandledHead) {
        this.lastHandledBlockHeight = Number(lastHandledHead.number);
        this.lastHandledBlockHash = lastHandledHead.hash;
        return;
      } else {
        throw new Error(`ckb node not synced to startBlockHeight ${lastHandledBlockHeight} yet`);
      }
    }

    const currentBlock = await this.ckb.rpc.getTipHeader();
    this.lastHandledBlockHeight = Number(currentBlock.number);
    this.lastHandledBlockHash = currentBlock.hash;
  }

  async watchNewBlock(): Promise<void> {
    await this.setStartTipBlockHeight();
    await this.initLastHandledBlock();
    const maxBatchSize = 5000;
    let currentHeight: number | null = null;
    foreverPromise(
      async () => {
        const blockNumber = await this.ckb.rpc.getTipBlockNumber();
        currentHeight = Number(blockNumber);
        logger.info(`currentHeight: ${currentHeight}, lastHandledBlock: ${this.lastHandledBlockHeight}`);
        if (currentHeight - this.lastHandledBlockHeight < 1) {
          // already handled, wait for new block
          await asyncSleep(8000);
          return;
        }
        const confirmBlockNumber = this.lastHandledBlockHeight - ForceBridgeCore.config.ckb.confirmNumber;
        const startBlockNumber = (confirmBlockNumber < 0 ? 0 : confirmBlockNumber) + 1;
        let endBlockNumber = currentHeight;
        if (currentHeight - this.lastHandledBlockHeight > maxBatchSize) {
          endBlockNumber = this.lastHandledBlockHeight + maxBatchSize;
        }
        asserts(startBlockNumber <= endBlockNumber);
        const block = await this.ckb.rpc.getBlockByNumber(BigInt(endBlockNumber));
        await this.handleTxs(startBlockNumber, endBlockNumber, currentHeight);
        await this.setLastHandledBlock(endBlockNumber, block.header.hash);
        BridgeMetricSingleton.getInstance(this.role).setBlockHeightMetrics('ckb', endBlockNumber, currentHeight);
        logger.info(`CkbHandler onBlock blockHeight:${endBlockNumber} blockHash:${block.header.hash}`);
      },
      {
        onRejectedInterval: 3000,
        onResolvedInterval: 0,
        onRejected: (e: Error) => {
          logger.error(`CKB watchNewBlock blockHeight:${this.lastHandledBlockHeight + 1} error:${e.stack}`);
        },
      },
    );
  }

  async getTransactions(searchKey: SearchKey): Promise<CkbTxInfo[]> {
    const txs = lodash.uniqBy(await this.ckbIndexer.getTransactions(searchKey), 'tx_hash');
    const result: CkbTxInfo[] = [];
    for (const tx of txs) {
      const txWithStatus = await this.ckb.rpc.getTransaction(tx.tx_hash);
      result.push({
        info: tx,
        tx: txWithStatus,
      });
    }
    return result;
  }

  async handleTxs(fromBlockNum: number, toBlockNum: number, currentHeight: number): Promise<void> {
    const mintSearchKey: SearchKey = {
      filter: { block_range: ['0x' + fromBlockNum.toString(16), '0x' + (toBlockNum + 1).toString(16)] },
      script: {
        code_hash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
        hash_type: ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
        args: '0x',
      },
      script_type: ScriptType.lock,
    };
    const burnSearchKey: SearchKey = {
      filter: { block_range: ['0x' + fromBlockNum.toString(16), '0x' + (toBlockNum + 1).toString(16)] },
      script: {
        code_hash: ForceBridgeCore.config.ckb.deps.recipientType.script.codeHash,
        hash_type: ForceBridgeCore.config.ckb.deps.recipientType.script.hashType,
        args: '0x',
      },
      script_type: ScriptType.type,
    };

    const committeeMultisigLockscript = parseAddress(getOmniLockMultisigAddress());
    const committeeMultisigLockSearchKey: SearchKey = {
      filter: { block_range: ['0x' + fromBlockNum.toString(16), '0x' + (toBlockNum + 1).toString(16)] },
      script: committeeMultisigLockscript,
      script_type: ScriptType.lock,
    };
    logger.info(`committeeMultisigLockSearchKey: ${JSON.stringify(committeeMultisigLockSearchKey, null, 2)}`);
    const mintTxs = await this.getTransactions(mintSearchKey);
    const burnTxs = await this.getTransactions(burnSearchKey);
    const committeeMultisigTxs = await this.getTransactions(committeeMultisigLockSearchKey);
    logger.info(
      `CkbHandler onBlock handle logs from ${fromBlockNum} to ${toBlockNum}, mint txs: ${JSON.stringify(
        mintTxs.map((tx) => tx.info.tx_hash),
      )}, burn txs: ${JSON.stringify(burnTxs.map((tx) => tx.info.tx_hash))}, committeeMultisigTxs txs: ${JSON.stringify(
        committeeMultisigTxs.map((tx) => tx.info.tx_hash),
      )}`,
    );

    for (const tx of mintTxs) {
      const parsedMintRecords = await this.parseMintTx(tx.tx.transaction, Number(tx.info.block_number));
      if (parsedMintRecords) {
        await this.onMintTx(Number(tx.info.block_number), parsedMintRecords);
        BridgeMetricSingleton.getInstance(this.role).addBridgeTxMetrics('ckb_mint', 'success');
      }
    }

    for (const tx of burnTxs) {
      await this.onBurnTx(tx, currentHeight);
    }

    for (const tx of committeeMultisigTxs) {
      const firstOutputLockscript = tx.tx.transaction.outputs[0].lock;
      if (
        firstOutputLockscript.codeHash === committeeMultisigLockscript.code_hash &&
        firstOutputLockscript.hashType === committeeMultisigLockscript.hash_type &&
        firstOutputLockscript.args === committeeMultisigLockscript.args
      ) {
        await this.onLockTx(tx, currentHeight);
      } else {
        await this.onUnlockTx(tx, currentHeight);
      }
    }
  }

  async onMintTx(blockNumber: number, mintedRecords: MintedRecords): Promise<void> {
    await this.db.watcherCreateMint(blockNumber, mintedRecords);
    await this.db.updateBridgeInRecords(mintedRecords);
    if (this.role === 'collector') {
      await this.db.updateCollectorCkbMintStatus(blockNumber, mintedRecords.txHash, 'success');
    }
  }

  async onBurnTx(txInfo: CkbTxInfo, currentHeight: number): Promise<void> {
    const tx = txInfo.tx.transaction;
    const txHash = txInfo.info.tx_hash;
    const records = await this.db.getCkbBurnByTxHashes([txHash]);
    if (records.length > 1) {
      logger.error('unexpected db find error', records);
      throw new Error(`unexpected db find error, records.length = ${records.length}`);
    }
    const blockNumber = Number(txInfo.info.block_number);
    const confirmedNumber = currentHeight - blockNumber;
    const confirmed = confirmedNumber >= ForceBridgeCore.config.ckb.confirmNumber;
    const confirmStatus = confirmed ? 'confirmed' : 'unconfirmed';
    logger.info(`handle burn tx ${txHash}, confirmed number: ${confirmedNumber}, confirmed: ${confirmed}`);
    // create new CkbBurn record
    let unlockRecords = records;
    if (records.length === 0) {
      const cellData = await parseBurnTx(tx);
      if (cellData === null) {
        return;
      }
      const previousOutput = nonNullable(tx.inputs[0].previousOutput);
      const burnPreviousTx: TransactionWithStatus = await this.ckb.rpc.getTransaction(previousOutput.txHash);
      const senderLockscript = burnPreviousTx.transaction.outputs[Number(previousOutput.index)].lock;
      const senderAddress = generateAddress({
        code_hash: senderLockscript.codeHash,
        hash_type: senderLockscript.hashType,
        args: senderLockscript.args,
      });
      const data: BurnDbData = {
        senderAddress: senderAddress,
        cellData: cellData,
      };
      const chain = data.cellData.getChain();
      const asset = uint8ArrayToString(new Uint8Array(data.cellData.getAsset().raw()));
      const burn: ICkbBurn = {
        senderAddress: data.senderAddress,
        ckbTxHash: txHash,
        asset: asset,
        bridgeFee: '0',
        chain,
        amount: utils.readBigUInt128LE(`0x${toHexString(new Uint8Array(data.cellData.getAmount().raw()))}`).toString(),
        recipientAddress: uint8ArrayToString(new Uint8Array(data.cellData.getRecipientAddress().raw())),
        blockNumber: Number(txInfo.info.block_number),
        confirmNumber: confirmedNumber,
        confirmStatus,
      };
      if (burn.recipientAddress.length > 10240 || burn.senderAddress.length > 10240) {
        logger.warn(
          `skip createCkbBurn for record ${JSON.stringify(
            burn,
          )}, reason: recipientAddress or senderAddress too long to fit in database`,
        );
        return;
      }
      await this.db.createCkbBurn([burn]);
      await this.db.updateBurnBridgeFee([burn]);
      unlockRecords = [burn];
      BridgeMetricSingleton.getInstance(this.role).addBridgeTxMetrics('ckb_burn', 'success');
      BridgeMetricSingleton.getInstance(this.role).addBridgeTokenMetrics('ckb_burn', [
        {
          token: burn.asset,
          amount: Number(burn.amount),
        },
      ]);
      logger.info(
        `CkbHandler watchBurnEvents saveBurnEvent success, ckbTxHash:${tx.hash} senderAddress:${senderAddress}`,
      );
    }
    if (records.length === 1) {
      await this.db.updateBurnConfirmNumber([{ txHash, confirmedNumber, confirmStatus }]);
      logger.info(`update burn record ${txHash} status, confirmed number: ${confirmedNumber}, confirmed: ${confirmed}`);
    }
    if (confirmed && this.role === 'collector') {
      const unlockRecord = unlockRecords[0];
      try {
        const asset = getAsset(unlockRecord.chain, unlockRecord.asset);
        const fee = asset.getBridgeFee('out');
        if (BigInt(unlockRecord.amount) <= BigInt(fee)) {
          throw new Error(`unlock record amount ${unlockRecord.amount} low than fee ${fee}`);
        }
        unlockRecord.bridgeFee = fee;
      } catch (e) {
        logger.warn(`fail to get fee to confirm burn, err: ${e.stack}`);
        return;
      }
      await this.onCkbBurnConfirmed([unlockRecord]);
      logger.info(`save unlock successful for burn tx ${txHash}`);
    }
  }

  async onLockTx(txInfo: CkbTxInfo, currentHeight: number): Promise<void> {
    const tx = txInfo.tx.transaction;
    const txHash = txInfo.info.tx_hash;
    const records = await this.db.getCkbLockByTxHashes([txHash]);
    if (records.length > 1) {
      logger.error('unexpected db find error', records);
      throw new Error(`unexpected db find error, records.length = ${records.length}`);
    }
    const cellData = await this.parseLockTx(tx);
    if (!cellData) {
      return;
    }
    const { amount, xchain, recipientAddress, committeeMultisigCellCapacity, assetIdent, senderAddress, bridgeFee } =
      cellData;
    const ckbTxHash = tx.hash;
    const blockNumber = Number(txInfo.info.block_number);
    const confirmedNumber = currentHeight - blockNumber;
    const confirmed = confirmedNumber >= ForceBridgeCore.config.ckb.confirmNumber;
    const confirmStatus = confirmed ? 'confirmed' : 'unconfirmed';
    const block = await this.ckb.rpc.getBlock(txInfo.tx.txStatus.blockHash!);
    logger.info(`handle ckb lock tx ${txHash}, confirmed number: ${confirmedNumber}, confirmed: ${confirmed}`);
    // create new CkbLock record
    if (records.length === 0) {
      logger.info(
        `CkbHandler watchLockEvents receiveLog blockHeight:${blockNumber} blockHash:${txInfo.tx.txStatus.blockHash} txHash:${txHash} amount:${amount} capacity:${committeeMultisigCellCapacity} asset:${cellData?.assetIdent}  sender:${cellData?.senderAddress}, confirmedNumber: ${confirmedNumber}, confirmed: ${confirmed}`,
      );
      logger.debug('CkbHandler watchLockEvents eth lockEvtLog:', { tx, cellData });
      await this.db.createCkbLock([
        {
          ckbTxHash,
          xchain,
          senderAddress,
          assetIdent,
          amount: `0x${amount.toString(16)}`,
          bridgeFee: `0x${bridgeFee.toString(16)}`,
          recipientAddress,
          blockNumber,
          blockTimestamp: Number(block.header.timestamp),
          confirmNumber: confirmedNumber,
          confirmStatus,
        },
      ]);
      BridgeMetricSingleton.getInstance(this.role).addBridgeTxMetrics('ckb_lock', 'success');
      BridgeMetricSingleton.getInstance(this.role).addBridgeTokenMetrics('ckb_lock', [
        {
          amount: Number(amount),
          token: assetIdent,
        },
      ]);
      logger.info(`CkbHandler watchLockEvents save CkbLock successful for ckb tx ${txInfo.tx.transaction.hash}.`);
    }
    if (records.length === 1) {
      await this.db.updateLockConfirmNumber([{ ckbTxHash, confirmedNumber, confirmStatus }]);
      logger.info(`update lock record ${txHash} status, confirmed number: ${confirmedNumber}, status: ${confirmed}`);
    }
    if (assetIdent == '0x0000000000000000000000000000000000000000000000000000000000000000') {
      const ethMints = await this.db.getEthMintByCkbTxHashes([tx.hash]);
      if (ethMints && ethMints.length === 1) {
        const amountFromEthMint = BigInt(ethMints[0].amount);
        await this.db.updateLockAmountAndBridgeFee([
          {
            ckbTxHash,
            amount: `0x${amountFromEthMint.toString(16)}`,
            bridgeFee: `0x${(amount - amountFromEthMint).toString(16)}`,
          },
        ]);
        logger.info(
          `get EthMint when check ckb lock ethMints for update ckb lock, records: ${records}, tx: ${tx}, bridgeFee: ${ethMints}`,
        );
      }
    }

    if (confirmed && this.role === 'collector') {
      const ckbLocksSaved = await this.db.getCkbLockByTxHashes([ckbTxHash]);
      if (ckbLocksSaved.length !== 1) {
        logger.error(
          `get ckb locks saved is not single: txHash: ${txHash}, ckbTxHash: ${ckbTxHash}, ckbLocksSaved: ${ckbLocksSaved}`,
        );
        return;
      }
      const ckbLock = ckbLocksSaved[0];
      const filterReason = checkLock(amount, assetIdent, xchain, txHash, ckbLock);
      if (filterReason !== '') {
        logger.warn(`skip createEthMint for record: ${JSON.stringify(cellData)}, reason: ${filterReason}`);
        return;
      }
      const nervosAsset = new NervosAsset(assetIdent).getAssetInfo(xchain);
      let mintAmount: bigint;
      if (assetIdent == '0x0000000000000000000000000000000000000000000000000000000000000000') {
        const bridgeFeeFromConfig = BigInt(ForceBridgeCore.config.eth.lockNervosAssetFee);
        mintAmount = BigInt(ckbLock.amount) - bridgeFeeFromConfig;
      } else {
        mintAmount = BigInt(ckbLock.amount);
      }

      const erc20TokenAddress = nervosAsset!.xchainTokenAddress;
      const mintRecords = [
        {
          ckbTxHash,
          erc20TokenAddress,
          nervosAssetId: assetIdent,
          amount: `0x${mintAmount.toString(16)}`,
          recipientAddress: recipientAddress,
        },
      ];
      await this.db.createCollectorEthMint(mintRecords);
      logger.info(`save EthMint successful for ckb tx ${txHash}`);
    }
  }

  async onUnlockTx(_txInfo: CkbTxInfo, _currentHeight: number): Promise<void> {
    if (_txInfo.tx.transaction.inputs.length < 2) {
      return;
    }
    throw new Error('unimplement');
  }

  async parseMintTx(tx: Transaction, blockNumber: number): Promise<null | MintedRecords> {
    let isInputsContainBridgeCell = false;
    for (const input of tx.inputs) {
      const previousOutput = nonNullable(input.previousOutput);
      const preHash = previousOutput.txHash;
      const txPrevious = await this.ckb.rpc.getTransaction(preHash);
      if (txPrevious == null) {
        continue;
      }
      const inputLock = txPrevious.transaction.outputs[Number(previousOutput.index)].lock;
      if (
        inputLock.codeHash === ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash &&
        inputLock.hashType === ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType &&
        isTypeIDCorrect(inputLock.args)
      ) {
        isInputsContainBridgeCell = true;
        break;
      }
    }
    if (!isInputsContainBridgeCell) return null;

    const mintedSudtCellIndexes = new Array(0);
    tx.outputs.forEach((output, index) => {
      if (
        output.type &&
        output.type.codeHash === ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash &&
        output.type.hashType === ForceBridgeCore.config.ckb.deps.sudtType.script.hashType
      ) {
        mintedSudtCellIndexes.push(index);
      }
    });
    if (0 === mintedSudtCellIndexes.length) return null;

    const witnessArgs = new core.WitnessArgs(new Reader(tx.witnesses[0]));
    const inputTypeWitness = witnessArgs.getInputType().value().raw();
    const mintWitness = new MintWitness(inputTypeWitness, { validate: true });
    const lockTxHashes = mintWitness.getLockTxHashes();
    const parsedResult: MintedRecord[] = [];
    mintedSudtCellIndexes.forEach((value, index) => {
      const amount = utils.readBigUInt128LE(tx.outputsData[value]);
      const mintId = uint8ArrayToString(new Uint8Array(lockTxHashes.indexAt(index).raw()));
      const lockTxHash = mintId.split('-')[0];
      parsedResult.push({ amount: amount, id: mintId, lockTxHash: lockTxHash, lockBlockHeight: blockNumber });
    });
    return { txHash: tx.hash, records: parsedResult };
  }

  async filterMintRecordsWithChainData(records: CollectorCkbMint[]): Promise<CollectorCkbMint[]> {
    const inMintRecords = (await this.db.getCkbMintByIds(records.map((r) => r.id))).map((r) => r.id);
    if (inMintRecords.length > 0) {
      await this.db.setCollectorCkbMintToSuccess(inMintRecords);
      return records.filter((r) => inMintRecords.indexOf(r.id) < 0);
    } else {
      return records;
    }
  }

  async todoMintRecordsHandler(ownerTypeHash: string, generator: CkbTxGenerator): Promise<void> {
    if (!this.syncedToStartTipBlockHeight()) {
      logger.info(
        `wait until syncing to startBlockHeight, lastHandledBlockHeight: ${this.lastHandledBlockHeight}, startTipBlockHeight: ${this.startTipBlockHeight}`,
      );
      return;
    }
    const rawMintRecords = await this.db.getCkbMintRecordsToMint('todo');
    // filter using CkbMint from chain
    const mintRecords = await this.filterMintRecordsWithChainData(rawMintRecords);
    if (mintRecords.length == 0) {
      logger.debug('wait for new mint records');
      await asyncSleep(3000);
      return;
    }
    logger.info(`CkbHandler handleMintRecords new mintRecords:${JSON.stringify(mintRecords)}`);
    await this.ckbIndexer.waitForSync();
    await this.doHandleMintRecords(mintRecords, ownerTypeHash, generator);
  }

  async doHandleMintRecords(mintRecords: ICkbMint[], ownerTypeHash: string, generator: CkbTxGenerator): Promise<void> {
    if (mintRecords.length === 0) {
      return;
    }

    const mintIds = mintRecords
      .map((ckbMint) => {
        return ckbMint.id;
      })
      .join(', ');
    const records = mintRecords.map((r) => this.filterMintRecords(r, ownerTypeHash));
    const newTokens = await this.filterNewTokens(records);
    if (newTokens.length > 0) {
      logger.info(
        `CkbHandler doHandleMintRecords bridge cell is not exist. do create bridge cell. ownerTypeHash: ${ownerTypeHash.toString()}`,
      );
      logger.info(`CkbHandler doHandleMintRecords createBridgeCell newToken`, newTokens);
      await this.ckbIndexer.waitForSync();
      await this.createBridgeCell(newTokens, generator);
    }

    for (;;) {
      try {
        mintRecords.map((r) => {
          r.status = 'pending';
        });
        await this.db.updateCollectorCkbMint(mintRecords);
        await this.ckbIndexer.waitForSync();
        break;
      } catch (e) {
        logger.error(`CkbHandler doHandleMintRecords prepare error:${e.stack}`);
        await asyncSleep(3000);
      }
    }

    logger.debug(`mint for records`, records);
    const txSkeleton = await generator.mint(records, this.ckbIndexer);
    logger.debug(`mint tx txSkeleton ${transactionSkeletonToJSON(txSkeleton)}`);
    const sigs = await this.collectMintSignatures(txSkeleton, mintRecords);
    for (;;) {
      try {
        if (typeof sigs === 'boolean' && (sigs as boolean)) {
          mintRecords.map((r) => {
            r.status = 'success';
          });
          break;
        }
        const signatures = sigs as string[];
        if (signatures.length < ForceBridgeCore.config.ckb.multisigScript.M) {
          const mintTxHash = txSkeleton.get('signingEntries').get(1)!.message;
          mintRecords.map((r) => {
            r.status = 'error';
            r.message = `sig number:${signatures.length} less than:${ForceBridgeCore.config.ckb.multisigScript.M}`;
            r.mintHash = mintTxHash;
          });
          logger.error(
            `CkbHandler doHandleMintRecords sig number:${signatures.length} less than:${ForceBridgeCore.config.ckb.multisigScript.M}, mintIds:${mintIds}`,
          );
          break;
        }

        const content0 = key.signRecoverable(
          txSkeleton.get('signingEntries').get(0)!.message,
          ForceBridgeCore.config.ckb.privateKey,
        );
        let content1 = serializeMultisigScript(ForceBridgeCore.config.ckb.multisigScript);
        content1 += signatures.join('');

        logger.debug(`txSkeleton: ${transactionSkeletonToJSON(txSkeleton)}`);
        const tx = sealTransaction(txSkeleton, [content0, content1]);
        const mintTxHash = await this.rpc.send_transaction(tx, 'passthrough');
        logger.info(
          `CkbHandler doHandleMintRecords Mint Transaction has been sent, ckbTxHash ${mintTxHash}, mintIds:${mintIds}`,
        );

        const txStatus = await this.waitUntilCommitted(mintTxHash, 200);
        if (txStatus && txStatus.txStatus.status === 'committed') {
          const mintTokens: txTokenInfo[] = [];
          mintRecords.map((r) => {
            r.status = 'success';
            r.mintHash = mintTxHash;
            mintTokens.push({
              token: r.asset,
              amount: Number(r.amount),
            });
          });
          BridgeMetricSingleton.getInstance(this.role).addBridgeTokenMetrics('ckb_mint', mintTokens);
        } else {
          logger.error(`CkbHandler doHandleMintRecords mint execute failed, mintIds:${mintIds}`);
          BridgeMetricSingleton.getInstance(this.role).addBridgeTxMetrics('ckb_mint', 'failed');
          mintRecords.map((r) => {
            r.status = 'error';
            r.mintHash = mintTxHash;
            r.message = 'mint execute failed';
          });
        }
        break;
      } catch (e) {
        logger.debug(`CkbHandler doHandleMintRecords mint mintIds:${mintIds} error:${e.stack}`);
        await asyncSleep(3000);
      }
    }

    for (;;) {
      try {
        await this.db.updateCollectorCkbMint(mintRecords);
        logger.info('CkbHandler doHandleMintRecords mint execute completed, mintIds:', mintIds);
        break;
      } catch (e) {
        logger.error(`CkbHandler doHandleMintRecords db.updateCkbMint mintIds:${mintIds} error:${e.stack}`);
      }
    }
  }

  async collectMintSignatures(
    txSkeleton: TransactionSkeletonType,
    mintRecords: ICkbMint[],
  ): Promise<string[] | boolean> {
    return await this.multisigMgr.collectSignatures({
      rawData: txSkeleton.get('signingEntries').get(1)!.message,
      payload: {
        sigType: 'mint',
        mintRecords: mintRecords.map((r) => {
          return {
            id: r.id,
            chain: r.chain,
            asset: r.asset,
            amount: r.amount,
            recipientLockscript: r.recipientLockscript,
            sudtExtraData: r.sudtExtraData,
          };
        }),
        txSkeleton: txSkeleton.toJS(),
      },
    });
  }

  async collectUnlockSignatures(
    txSkeleton: TransactionSkeletonType,
    records: ICkbUnlock[],
    generator: CkbTxGenerator,
  ): Promise<string[] | boolean> {
    const privateKeys = [
      'vxokyS9hU63bBLDvb1tquJI6Cbo4J0z4+LJ9V54Rqd0GAgyV/9bzmnEXsSwLqhvvlo5w1jNK3R/d/jojH21OkZIP6wRu/xDUn8y85EyySduvSDqJ',
      'Tglw0nMGPPFNSQrvGX2IjpTeoCnpi2PgNSv1+w8ALtRTTcBQ9Ff/knMYADtu2I2KJwy0V60HWSJPJUWaflTb25TbNM0bgH/vMgM2XJJK7DKzHbHM',
      'yVKmcQTAss9uST1l5yvAPSnr2nlPgyCRwoA1fA0Z64AoY/QziCyWH1oy4q8oVZ68qxLxsojYYZYPygCvsrwcGQeawiotIfhzFVv07w6nKqQP22Xh',
      'opVPjBuBZyCZNWoY7WPt3B6t/ZbJdtC3Rxy+Kp0rXDA8Imwoy0VJaL3hvazbMb0mlSjiUS7IJCGlxt586+Wshhcke+bpcL4edWzObTsAwaX+YNPU',
      '8X0mlNlA5NOPXOkBOwIfTfH/pfzLR0aurnW6d0Rz7wgFZrajAQYvh8gG0e8TDvtBA3unTzwVjBm3BRGK3pea/NSZFjgtv6otiuax3NPDTQBpBQNC',
    ];
    const { message } = nonNullable(txSkeleton.get('signingEntries').get(0));
    logger.info(`unlock omnilock msg: ${message}`);
    const sigs = privateKeys.map((privKey) => {
      return key.signRecoverable(message, privKey).slice(2);
    });
    return sigs;
  }

  filterMintRecords(r: ICkbMint, ownerTypeHash: string): MintAssetRecord {
    switch (r.chain) {
      case ChainType.BTC:
        return {
          id: r.id,
          asset: new BtcAsset(r.asset, ownerTypeHash),
          recipient: r.recipientLockscript,
          amount: BigInt(r.amount),
          sudtExtraData: r.sudtExtraData,
        };
      case ChainType.ETH:
        return {
          id: r.id,
          asset: new EthAsset(r.asset, ownerTypeHash),
          recipient: r.recipientLockscript,
          amount: BigInt(r.amount),
          sudtExtraData: r.sudtExtraData,
        };
      case ChainType.TRON:
        return {
          id: r.id,
          asset: new TronAsset(r.asset, ownerTypeHash),
          recipient: r.recipientLockscript,
          amount: BigInt(r.amount),
          sudtExtraData: r.sudtExtraData,
        };
      case ChainType.EOS:
        return {
          id: r.id,
          asset: new EosAsset(r.asset, ownerTypeHash),
          recipient: r.recipientLockscript,
          amount: BigInt(r.amount),
          sudtExtraData: r.sudtExtraData,
        };
      default:
        throw new Error('asset not supported!');
    }
  }

  async filterNewTokens(records: MintAssetRecord[]): Promise<MintAssetRecord[]> {
    const newTokens: MintAssetRecord[] = [];
    const assets: string[] = [];
    for (const record of records) {
      if (assets.indexOf(record.asset.toBridgeLockscriptArgs()) != -1) {
        continue;
      }
      assets.push(record.asset.toBridgeLockscriptArgs());

      logger.debug('CkbHandler filterNewTokens record:', record);
      const bridgeCellLockscript = {
        code_hash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
        hash_type: ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
        args: record.asset.toBridgeLockscriptArgs(),
      };
      logger.debug('CkbHandler filterNewTokens bridgeCellLockscript ', bridgeCellLockscript);
      const searchKey = {
        script: bridgeCellLockscript,
        script_type: ScriptType.lock,
      };
      const bridgeCells = await this.ckbIndexer.getCells(searchKey);
      if (bridgeCells.length == 0) {
        newTokens.push(record);
      }
    }
    return newTokens;
  }

  async createBridgeCell(newTokens: MintAssetRecord[], generator: CkbTxGenerator): Promise<void> {
    const assets: createAsset[] = [];
    const scripts = newTokens.map((r) => {
      assets.push({
        chain: r.asset.chainType,
        asset: r.asset.getAddress(),
      });
      return {
        code_hash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
        args: r.asset.toBridgeLockscriptArgs(),
        hash_type: ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
      };
    });

    const txSkeleton = await generator.createBridgeCell(scripts);
    const message0 = txSkeleton.get('signingEntries').get(0)!.message;
    const content0 = key.signRecoverable(message0, ForceBridgeCore.config.ckb.privateKey);
    let content1 = serializeMultisigScript(ForceBridgeCore.config.ckb.multisigScript);
    const sigs = await this.multisigMgr.collectSignatures({
      rawData: txSkeleton.get('signingEntries').get(1)!.message,
      payload: {
        sigType: 'create_cell',
        createAssets: assets,
        txSkeleton: txSkeleton.toJS(),
      },
    });
    const signatures = sigs as string[];
    if (signatures.length < ForceBridgeCore.config.ckb.multisigScript.M) {
      throw new Error(
        `createBridgeCell collect signatures failed, expected:${ForceBridgeCore.config.ckb.multisigScript.M}, collected:${signatures.length}`,
      );
    }
    content1 += signatures.join('');

    const tx = sealTransaction(txSkeleton, [content0, content1]);
    logger.info(`tx: ${JSON.stringify(tx)}`);
    const txHash = await this.rpc.send_transaction(tx, 'passthrough');
    const txStatus = await this.waitUntilCommitted(txHash, 120);
    if (txStatus === null || txStatus.txStatus.status !== 'committed') {
      throw new Error('fail to createBridgeCell');
    }
  }

  async waitUntilCommitted(txHash: string, timeout: number): Promise<TransactionWithStatus | null> {
    let waitTime = 0;
    let txStatus: TransactionWithStatus | null = null;
    for (;;) {
      try {
        txStatus = await this.ckb.rpc.getTransaction(txHash);
        if (txStatus === null) {
          logger.warn(`CkbHandler waitUntilCommitted tx ${txHash} status: null, index: ${waitTime}`);
          return null;
        }
        logger.debug(
          `CkbHandler waitUntilCommitted tx ${txHash} status: ${txStatus.txStatus.status}, index: ${waitTime}`,
        );
        if (txStatus.txStatus.status === 'committed') {
          return txStatus;
        }
      } catch (e) {
        logger.error(`CkbHandler waitUntilCommitted error:${e.stack}`);
      }
      waitTime += 1;
      if (waitTime >= timeout) {
        return txStatus;
      }
      await asyncSleep(1000);
    }
  }

  // watch the ckb_unlock table and handle the new unlock events
  // send tx according to the data
  async todoUnlockRecordsHandler(ownerTypeHash: string, generator: CkbTxGenerator): Promise<void> {
    if (!this.syncedToStartTipBlockHeight()) {
      logger.info(
        `wait until syncing to startBlockHeight, lastHandledBlockHeight: ${this.lastHandledBlockHeight}, startTipBlockHeight: ${this.startTipBlockHeight}`,
      );
      return;
    }
    logger.debug('CkbHandler watchUnlockEvents get new unlock events and send tx');
    const records = await this.getOneKindAssetToUnlockRecords();
    if (records.length === 0) {
      logger.info('wait for todo unlock records');
      await asyncSleep(3000);
      return;
    }
    logger.info(`CkbHandler watchUnlockEvents unlock records: ${JSON.stringify(records)}`);
    await this.ckbIndexer.waitForSync();
    await this.doHandleUnlockRecords(records, generator);
  }

  async doHandleUnlockRecords(records: ICkbUnlock[], generator: CkbTxGenerator): Promise<void> {
    if (records.length === 0) {
      return;
    }

    const unlockIds = records
      .map((unlockRecord) => {
        return unlockRecord.id;
      })
      .join(', ');

    logger.info(
      `CkbHandler doHandleUnlockRecords start process unlock Record, unlockIds: ${unlockIds} num:${records.length}`,
    );

    records.map((r) => {
      r.status = 'pending';
    });
    await this.db.saveCollectorCkbUnlock(records);
    await this.ckbIndexer.waitForSync();
    const txSkeleton = await generator.unlock(records);
    if (!txSkeleton) {
      return;
    }
    logger.debug(`unlock for records, txSkeleton`, records, transactionSkeletonToJSON(txSkeleton));
    const sigs = await this.collectUnlockSignatures(txSkeleton, records, generator);
    for (;;) {
      try {
        if (typeof sigs === 'boolean' && (sigs as boolean)) {
          records.map((r) => {
            r.status = 'success';
          });
          break;
        }
        const signatures = sigs as string[];
        if (signatures.length < ForceBridgeCore.config.ckb.multisigScript.M) {
          const { message: unlockTxHash } = nonNullable(
            txSkeleton
              .get('signingEntries')
              .filter((value) => value.index === 1)
              .get(0),
          );
          records.map((r) => {
            r.status = 'error';
            r.message = `sig number:${signatures.length} less than:${ForceBridgeCore.config.ckb.multisigScript.M}`;
            r.unlockTxHash = unlockTxHash;
          });
          logger.error(
            `CkbHandler doHandleUnlockRecords sig number: ${signatures.length} less than: ${ForceBridgeCore.config.ckb.multisigScript.M}, unlockIds: ${unlockIds}`,
          );
          break;
        }
        const multisigs = signatures.join('');
        logger.info(`multisigs: ${multisigs}`);
        const smtProof = ForceBridgeCore.getSmtProof();
        const serializedMultisigScript = serializeMultisigScript(ForceBridgeCore.config.ckb.multisigScript);
        const signaturePlaceHolder = serializedMultisigScript + multisigs;
        logger.info(`sigs: ${signaturePlaceHolder}`);
        const authMultisigBlake160 = new utils.CKBHasher().update(serializedMultisigScript).digestHex().slice(0, 42);
        const omniLockWitness = {
          signature: new Reader(signaturePlaceHolder),
          rc_identity: {
            identity: new Reader(`0x06${authMultisigBlake160.slice(2)}`),
            proofs: [{ mask: 3, proof: new Reader(smtProof) }],
          },
        };
        const omniLockWitnessHexString = new Reader(SerializeRcLockWitnessLock(omniLockWitness)).serializeJson();
        const witness = new Reader(
          SerializeWitnessArgs(
            normalizers.NormalizeWitnessArgs({
              lock: omniLockWitnessHexString,
            }),
          ),
        ).serializeJson();

        const { message: collectorMessageToSign } = nonNullable(
          txSkeleton
            .get('signingEntries')
            .filter((value) => value.index === 0)
            .get(0),
        );
        logger.info(`collectorMessageToSign: ${collectorMessageToSign}`);
        const collectorSignature = key.signRecoverable(collectorMessageToSign, ForceBridgeCore.config.ckb.privateKey);

        const collectorWitness = new Reader(
          SerializeWitnessArgs(
            normalizers.NormalizeWitnessArgs({
              lock: collectorSignature,
            }),
          ),
        ).serializeJson();

        const signedTxSkeleton = txSkeleton.update('witnesses', (witnesses) => {
          return witnesses.map((value, index) => {
            if (index === 0) {
              return collectorWitness;
            } else if (index !== txSkeleton.witnesses.size - 1 && value !== '0x') {
              return witness;
            }
            return value;
          });
        });

        const transaction = createTransactionFromSkeleton(signedTxSkeleton);
        const txHash = await this.rpc.send_transaction(transaction);
        const txStatus = await this.waitUntilCommitted(txHash, 200);
        if (txStatus && txStatus.txStatus.status === 'committed') {
          const unlockTokens: txTokenInfo[] = [];
          records.map((r) => {
            r.status = 'success';
            r.unlockTxHash = txHash;
            unlockTokens.push({
              token: r.assetIdent,
              amount: Number(r.amount),
            });
          });
          BridgeMetricSingleton.getInstance(this.role).addBridgeTokenMetrics('ckb_unlock', unlockTokens);
        } else {
          logger.error(`CkbHandler doHandleUnlockRecords unlock execute failed, unlockIds: ${unlockIds}`);
          BridgeMetricSingleton.getInstance(this.role).addBridgeTxMetrics('ckb_unlock', 'failed');
          records.map((r) => {
            r.status = 'error';
            r.unlockTxHash = txHash;
            r.message = 'unlock execute failed';
          });
        }
        break;
      } catch (e) {
        logger.debug(`CkbHandler doHandleUnlockRecords unlock unlockIds: ${unlockIds} error: ${e.stack}`);
        await asyncSleep(3000);
      }
    }
    for (;;) {
      try {
        await this.db.saveCollectorCkbUnlock(records);
        logger.info(`EthHandler doHandleUnlockRecords process unlock Record completed unlockIds: ${unlockIds}`);
        break;
      } catch (e) {
        logger.error(`EthHandler doHandleUnlockRecords db.saveCkbUnlock unlockIds: ${unlockIds} error:${e.stack}`);
        await asyncSleep(3000);
      }
    }
  }

  async getOneKindAssetToUnlockRecords(take = 50): Promise<CkbUnlock[]> {
    const latestCollectorCkbToUnlock = await this.db.getLatestCollectorCkbToUnlockRecord();
    if (latestCollectorCkbToUnlock === undefined) {
      logger.info('get latest collector ckb to unlock record empty, no records to unlock.');
      return [];
    }
    const assetIdent = latestCollectorCkbToUnlock.assetIdent;
    const toUnlockRecords = await this.db.getCollectorCkbUnlockRecordsToUnlockByAssetIdent(assetIdent, take);
    const unlockedRecords = (await this.db.getCkbUnlockByBurnTxHashes(toUnlockRecords.map((r) => r.burnTxHash))).map(
      (r) => r.burnTxHash,
    );
    if (unlockedRecords.length > 0) {
      await this.db.setCollectorCkbUnlockToSuccess(unlockedRecords);
      return toUnlockRecords.filter((r) => unlockedRecords.indexOf(r.burnTxHash) < 0);
    } else {
      return toUnlockRecords;
    }
  }

  handleMintAndUnlockRecords(generator: CkbTxGenerator): void {
    if (this.role !== 'collector') {
      return;
    }
    const ownerTypeHash = getOwnerTypeHash();
    this.handleTodoMintAndUnlockRecords(ownerTypeHash, generator);
  }

  handleTodoMintAndUnlockRecords(ownerTypeHash: string, generator: CkbTxGenerator): void {
    foreverPromise(
      async () => {
        const todoHandler = this.todoRoundHandlers[this.todoRoundIndex];
        logger.info(`todoHandler to run index: ${this.todoRoundIndex}, function: ${todoHandler.name}`);
        this.todoRoundIndex = (this.todoRoundIndex + 1) % this.todoRoundHandlers.length;
        logger.info(`todoHandler next to run index: ${this.todoRoundIndex}`);
        await todoHandler.apply(this, [ownerTypeHash, generator]);
      },
      {
        onRejectedInterval: 15000,
        onResolvedInterval: 15000,
        onRejected: (e: Error) => {
          logger.error(`CKB handleTodoMintAndUnlockRecords error:${e.stack}`);
        },
      },
    );
  }

  async parseLockTx(tx: Transaction): Promise<NervosLockAssetTxMetaData | null> {
    if (tx.outputs.length < 1 || tx.witnesses.length <= 1 || tx.inputs.length < 1) {
      return null;
    }
    const recipientOutput = nonNullable(tx.outputs[0]);
    const committeeMultisigCellCapacity = BigInt(nonNullable(recipientOutput.capacity));
    const recipientTypescript = recipientOutput.type;
    const recipientLockscript = nonNullable(recipientOutput.lock);
    logger.debug('recipientTypescript:', recipientTypescript);

    const sudtTypescript = ForceBridgeCore.config.ckb.deps.sudtType.script;
    const previousOutput = nonNullable(tx.inputs[0].previousOutput);
    const preHash = previousOutput.txHash;
    const txPrevious = await this.ckb.rpc.getTransaction(preHash);
    if (txPrevious == null) {
      return null;
    }
    const senderLockscript = txPrevious.transaction.outputs[Number(previousOutput.index)].lock;
    const committeeMultisigLockscript = parseAddress(getOmniLockMultisigAddress());
    if (
      !senderLockscript ||
      (senderLockscript.codeHash === committeeMultisigLockscript.code_hash &&
        senderLockscript.hashType === committeeMultisigLockscript.hash_type &&
        senderLockscript.args === committeeMultisigLockscript.args)
    ) {
      logger.warn(`sender should not be committee multisig cell`);
      return null;
    }

    if (tx.inputs.length > 1) {
      for (let i = 1; i < tx.inputs.length; i++) {
        const thisPreviousOutput = nonNullable(tx.inputs[i].previousOutput);
        const thisPreHash = thisPreviousOutput.txHash;
        const thisTxPrevious = await this.ckb.rpc.getTransaction(thisPreHash);
        if (thisTxPrevious == null) {
          return null;
        }
        const thisSenderLockscript = thisTxPrevious.transaction.outputs[Number(thisPreviousOutput.index)].lock;
        if (
          !thisSenderLockscript ||
          thisSenderLockscript.codeHash !== senderLockscript.codeHash ||
          thisSenderLockscript.hashType !== senderLockscript.hashType ||
          thisSenderLockscript.args !== senderLockscript.args
        ) {
          logger.warn(`inputs contain different lockscripts`);
          return null;
        }
      }
    }

    if (
      recipientLockscript.codeHash !== committeeMultisigLockscript.code_hash ||
      recipientLockscript.hashType !== committeeMultisigLockscript.hash_type ||
      recipientLockscript.args !== committeeMultisigLockscript.args
    ) {
      logger.warn(`the first output must be committee multisig`);
      return null;
    }

    if (tx.outputs.length > 1) {
      for (let i = 1; i < tx.outputs.length; i++) {
        const thisLockscript = nonNullable(tx.outputs[i].lock);
        if (
          thisLockscript.codeHash === committeeMultisigLockscript.code_hash &&
          thisLockscript.hashType === committeeMultisigLockscript.hash_type &&
          thisLockscript.args === committeeMultisigLockscript.args
        ) {
          logger.warn(`the outputs except first must not be committee multisig`);
          return null;
        }
      }
    }

    let amount: bigint;
    let bridgeFee: bigint;
    let assetIdent: string;
    if (
      recipientTypescript &&
      recipientTypescript.codeHash === sudtTypescript.codeHash &&
      recipientTypescript.hashType === sudtTypescript.hashType
    ) {
      // lock sudt
      amount = utils.readBigUInt128LE(tx.outputsData[0]);
      assetIdent = utils.computeScriptHash({
        code_hash: recipientTypescript.codeHash,
        hash_type: recipientTypescript.hashType,
        args: recipientTypescript.args,
      });
      bridgeFee = committeeMultisigCellCapacity;
    } else if (!recipientTypescript) {
      // lock ckb
      amount = committeeMultisigCellCapacity;
      assetIdent = '0x0000000000000000000000000000000000000000000000000000000000000000';
      bridgeFee = BigInt(0);
    } else {
      logger.error(`unsupported type script ${recipientTypescript}`);
      return null;
    }

    const lockMemoWitness = tx.witnesses[tx.witnesses.length - 1];
    const lockMemo = new LockMemo(new Reader(lockMemoWitness).toArrayBuffer());
    let xchain;
    let recipientAddress;
    try {
      xchain = lockMemo.getXchain();
      recipientAddress = new Reader(lockMemo.getRecipient().raw()).serializeJson();
    } catch (e) {
      logger.warn(`parse recipient data error: ${e.message} ${e.stack}`);
      return null;
    }
    const senderAddress = generateAddress({
      code_hash: senderLockscript.codeHash,
      hash_type: senderLockscript.hashType,
      args: senderLockscript.args,
    });
    logger.debug('amount: ', amount);
    logger.debug('xchain: ', xchain);
    logger.debug('recipient address: ', recipientAddress);
    logger.debug('recipient capacity: ', committeeMultisigCellCapacity);
    logger.debug('assetIdent: ', assetIdent);
    logger.debug('recipient lockscript: ', recipientLockscript);
    logger.debug('bridge fee: ', bridgeFee);
    const nervosLockAssetTxMetaData: NervosLockAssetTxMetaData = {
      amount,
      xchain,
      recipientAddress,
      committeeMultisigCellCapacity,
      assetIdent,
      senderAddress,
      bridgeFee,
    };
    return nervosLockAssetTxMetaData;
  }

  start(): void {
    void this.watchNewBlock();
    const generator = new CkbTxGenerator(
      ForceBridgeCore.config.ckb.ckbRpcUrl,
      ForceBridgeCore.config.ckb.ckbIndexerUrl,
    );
    this.handleMintAndUnlockRecords(generator);
    logger.info('ckb handler started 🚀');
  }
}

function isTypeIDCorrect(args: string): boolean {
  const expectOwnerTypeHash = getOwnerTypeHash();
  const bridgeLockArgs = new ForceBridgeLockscriptArgs(fromHexString(args).buffer);
  const ownerTypeHash = `0x${toHexString(new Uint8Array(bridgeLockArgs.getOwnerCellTypeHash().raw()))}`;
  return ownerTypeHash === expectOwnerTypeHash;
}

export async function parseBurnTx(tx: Transaction): Promise<RecipientCellData | null> {
  if (tx.outputs.length < 1 || tx.outputs[0].type === null) {
    return null;
  }
  const recipientTypescript = nonNullable(tx.outputs[0].type);
  const expectRecipientTypescript = ForceBridgeCore.config.ckb.deps.recipientType.script;
  logger.debug('recipientScript:', recipientTypescript);
  logger.debug('expect:', expectRecipientTypescript);
  if (
    recipientTypescript.codeHash !== expectRecipientTypescript.codeHash ||
    recipientTypescript.hashType !== expectRecipientTypescript.hashType
  ) {
    return null;
  }
  let cellData: RecipientCellData | null;
  try {
    cellData = new RecipientCellData(fromHexString(tx.outputsData[0]).buffer);
  } catch (e) {
    logger.warn(`parse recipient data error: ${e.message} ${e.stack}`);
    return null;
  }
  logger.debug('amount: ', toHexString(new Uint8Array(cellData.getAmount().raw())));
  logger.debug('recipient address: ', toHexString(new Uint8Array(cellData.getRecipientAddress().raw())));
  logger.debug('asset: ', toHexString(new Uint8Array(cellData.getAsset().raw())));
  logger.debug('chain: ', cellData.getChain());
  const recipientCellBridgeLockCodeHash = `0x${toHexString(new Uint8Array(cellData.getBridgeLockCodeHash().raw()))}`;
  const recipientCellBridgeLockHashType = cellData.getBridgeLockHashType() === 0 ? 'data' : 'type';
  const expectBridgeLockscript = ForceBridgeCore.config.ckb.deps.bridgeLock.script;
  const recipientCellOwnerTypeHash = `0x${toHexString(new Uint8Array(cellData.getOwnerCellTypeHash().raw()))}`;
  const ownerTypeHash = getOwnerTypeHash();
  if (
    recipientCellBridgeLockCodeHash !== expectBridgeLockscript.codeHash ||
    recipientCellBridgeLockHashType !== expectBridgeLockscript.hashType ||
    recipientCellOwnerTypeHash !== ownerTypeHash
  ) {
    return null;
  }
  return cellData;
}

export function checkLock(
  amount: bigint,
  assetIdent: string,
  xchain: number,
  txHash: string,
  ckbLock: CkbLock,
): string {
  const nervosAsset = new NervosAsset(assetIdent);
  const nervosAssetInfo = nervosAsset.getAssetInfo(xchain);
  if (!nervosAsset.inWhiteList(xchain)) {
    return `nervos assetIdent: ${assetIdent}, xchain: ${xchain} not in nervos asset white list`;
  }
  const minimalAmount = nervosAssetInfo!.minimalBridgeAmount;
  const bridgeFeeFromConfig = BigInt(ForceBridgeCore.config.eth.lockNervosAssetFee);
  const bridgeFeeSaved = BigInt(ckbLock.bridgeFee);
  if (assetIdent == '0x0000000000000000000000000000000000000000000000000000000000000000') {
    // lock ckb
    if (BigInt(ckbLock.amount) < BigInt(minimalAmount)) {
      const humanizeMinimalAmount = new BigNumber(minimalAmount)
        .times(new BigNumber(10).pow(-nervosAssetInfo!.decimal))
        .toString();
      return `on lock ckb, amount should be greater than or equals minimalAmount, amount: ${
        ckbLock.amount
      }, bridgeFee: ${bridgeFeeFromConfig}, minimalAmount: ${minimalAmount}, minimal bridge amount is ${humanizeMinimalAmount} ${
        nervosAssetInfo!.symbol
      }`;
    }
  } else {
    //lock sudt
    if (bridgeFeeSaved <= bridgeFeeFromConfig || BigInt(ckbLock.amount) < BigInt(minimalAmount)) {
      const humanizeMinimalAmount = new BigNumber(minimalAmount)
        .times(new BigNumber(10).pow(-nervosAssetInfo!.decimal))
        .toString();
      return `on lock sudt, bridgeFeeSaved should be greater than bridgeFeeFromConfig and amount should be greater than or equals minimalAmount, amount: ${
        ckbLock.amount
      }, bridgeFeeSaved: ${bridgeFeeSaved}, bridgeFeeFromConfig: ${bridgeFeeFromConfig}, minimalAmount: ${minimalAmount}, minimal bridge amount is ${humanizeMinimalAmount} ${
        nervosAssetInfo!.symbol
      }`;
    }
  }
  return '';
}

type BurnDbData = {
  cellData: RecipientCellData;
  senderAddress: string;
};
