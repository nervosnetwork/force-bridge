import { core, Script as LumosScript } from '@ckb-lumos/base';
import { serializeMultisigScript } from '@ckb-lumos/common-scripts/lib/secp256k1_blake160_multisig';
import { key } from '@ckb-lumos/hd';
import { sealTransaction, TransactionSkeletonType } from '@ckb-lumos/helpers';
import { RPC } from '@ckb-lumos/rpc';
import TransactionManager from '@ckb-lumos/transaction-manager';
import { Address, AddressType, Amount, HashType, Script } from '@lay2/pw-core';
import { Reader } from 'ckb-js-toolkit';
import { UpdateResult } from 'typeorm';
import { Account } from '../ckb/model/accounts';
import { BtcAsset, ChainType, EosAsset, EthAsset, TronAsset } from '../ckb/model/asset';
import { RecipientCellData } from '../ckb/tx-helper/generated/eth_recipient_cell';
import { ForceBridgeLockscriptArgs } from '../ckb/tx-helper/generated/force_bridge_lockscript';
import { MintWitness } from '../ckb/tx-helper/generated/mint_witness';
import { CkbTxGenerator, MintAssetRecord } from '../ckb/tx-helper/generator';
import { ScriptType } from '../ckb/tx-helper/indexer';
import { getOwnerTypeHash } from '../ckb/tx-helper/multisig/multisig_helper';
import { forceBridgeRole } from '../config';
import { ForceBridgeCore } from '../core';
import { CkbDb, KVDb } from '../db';
import { CkbMint, ICkbBurn, MintedRecords } from '../db/model';
import { asserts, nonNullable } from '../errors';
import { BridgeMetricSingleton, txTokenInfo } from '../monitor/bridge-metric';
import { createAsset, MultiSigMgr } from '../multisig/multisig-mgr';
import { asyncSleep, foreverPromise, fromHexString, toHexString, uint8ArrayToString } from '../utils';
import { logger } from '../utils/logger';
import { getAssetTypeByAsset } from '../xchain/tron/utils';
import Transaction = CKBComponents.Transaction;
import TransactionWithStatus = CKBComponents.TransactionWithStatus;
import Block = CKBComponents.Block;

const lastHandleCkbBlockKey = 'lastHandleCkbBlock';

// CKB handler
// 1. Listen CKB chain to get new burn events.
// 2. Listen database to get new mint events, send tx.
export class CkbHandler {
  private ckb = ForceBridgeCore.ckb;
  private ckbIndexer = ForceBridgeCore.ckbIndexer;
  private transactionManager: TransactionManager;
  private multisigMgr: MultiSigMgr;
  private lastHandledBlockHeight: number;
  private lastHandledBlockHash: string;

  constructor(private db: CkbDb, private kvDb: KVDb, private role: forceBridgeRole) {
    this.transactionManager = new TransactionManager(this.ckbIndexer);
    this.multisigMgr = new MultiSigMgr(
      'CKB',
      ForceBridgeCore.config.ckb.multiSignHosts,
      ForceBridgeCore.config.ckb.multisigScript.M,
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

  async onCkbBurnConfirmed(confirmedCkbBurns: ICkbBurn[]): Promise<void> {
    if (this.role !== 'collector') return;
    for (const burn of confirmedCkbBurns) {
      logger.info(`CkbHandler onCkbBurnConfirmed burnRecord:${JSON.stringify(burn, undefined, 2)}`);
      const unlockAmount = new Amount(burn.amount, 0).sub(new Amount(burn.bridgeFee, 0)).toString(0);
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
          await this.db.createEthUnlock([
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
      if (lastHandledHead !== undefined) {
        this.lastHandledBlockHeight = Number(lastHandledHead.number);
        this.lastHandledBlockHash = lastHandledHead.hash;
        return;
      }
    }

    const currentBlock = await this.ckb.rpc.getTipHeader();
    this.lastHandledBlockHeight = Number(currentBlock.number);
    this.lastHandledBlockHash = currentBlock.hash;
  }

  watchNewBlock(): void {
    void (async () => {
      await this.initLastHandledBlock();

      foreverPromise(
        async () => {
          const nextBlockHeight = this.lastHandledBlockHeight + 1;

          const block = await this.ckb.rpc.getBlockByNumber(BigInt(nextBlockHeight));
          if (block == null) return asyncSleep(5000);

          await this.onBlock(block);
          const currentBlock = await this.ckb.rpc.getTipHeader();
          BridgeMetricSingleton.getInstance(this.role).setBlockHeightMetrics(
            'ckb',
            nextBlockHeight,
            Number(currentBlock.number),
          );
        },
        {
          onRejectedInterval: 3000,
          onResolvedInterval: 5000,
          onRejected: (e: Error) => {
            logger.error(`CKB watchNewBlock blockHeight:${this.lastHandledBlockHeight + 1} error:${e.message}`);
          },
        },
      );
    })();
  }

  async onBlock(block: Block): Promise<void> {
    const blockNumber = Number(block.header.number);
    const blockHash = block.header.hash;
    logger.info(`CkbHandler onBlock blockHeight:${blockNumber} blockHash:${blockHash}`);

    const confirmNumber = ForceBridgeCore.config.ckb.confirmNumber;
    const confirmedBlockHeight = blockNumber - confirmNumber >= 0 ? blockNumber - confirmNumber : 0;
    if (
      confirmNumber !== 0 &&
      this.lastHandledBlockHeight === blockNumber - 1 &&
      this.lastHandledBlockHash !== '' &&
      block.header.parentHash !== this.lastHandledBlockHash
    ) {
      BridgeMetricSingleton.getInstance(this.role).setForkEventHeightMetrics('ckb', this.lastHandledBlockHeight);
      logger.warn(
        `CkbHandler onBlock blockHeight:${blockNumber} parentHash:${block.header.parentHash} != lastHandledBlockHash:${this.lastHandledBlockHash} fork occur removeUnconfirmedLock events from:${confirmedBlockHeight}`,
      );
      await this.db.removeUnconfirmedCkbBurn(confirmedBlockHeight);

      const confirmedBlock = await this.ckb.rpc.getBlockByNumber(BigInt(confirmedBlockHeight));
      await this.setLastHandledBlock(Number(confirmedBlock.header.number), confirmedBlock.header.hash);
      return;
    }

    const unconfirmedTxs = await this.db.getUnconfirmedBurn();
    if (unconfirmedTxs.length !== 0) {
      const updateConfirmNumberRecords = unconfirmedTxs
        .filter((record) => record.blockNumber > confirmedBlockHeight)
        .map((record) => {
          return { txHash: record.ckbTxHash, confirmedNumber: blockNumber - record.blockNumber };
        });
      if (updateConfirmNumberRecords.length !== 0) {
        await this.db.updateBurnConfirmNumber(updateConfirmNumberRecords);
      }

      const confirmedRecords = unconfirmedTxs.filter((record) => record.blockNumber <= confirmedBlockHeight);
      const confirmedTxHashes = confirmedRecords.map((burn) => {
        return burn.ckbTxHash;
      });

      if (confirmedRecords.length !== 0) {
        await this.db.updateCkbBurnConfirmStatus(confirmedTxHashes);
        await this.onCkbBurnConfirmed(confirmedRecords);
        logger.info(
          `CkbHandler onBlock updateCkbBurnConfirmStatus height:${blockNumber} ckbTxHashes:${confirmedTxHashes}`,
        );
      }
    }

    const burnTxs = new Map();
    for (const tx of block.transactions) {
      const parsedMintRecords = await this.parseMintTx(tx);
      if (parsedMintRecords) {
        await this.onMintTx(parsedMintRecords);
        BridgeMetricSingleton.getInstance(this.role).addBridgeTxMetrics('ckb_mint', 'success');
      }
      const recipientData = tx.outputsData[0];
      let cellData;
      try {
        cellData = new RecipientCellData(fromHexString(recipientData).buffer);
      } catch (e) {
        continue;
      }
      if (await isBurnTx(tx, cellData)) {
        const previousOutput = nonNullable(tx.inputs[0].previousOutput);
        const burnPreviousTx: TransactionWithStatus = await this.ckb.rpc.getTransaction(previousOutput.txHash);
        const senderAddress = Account.scriptToAddress(
          burnPreviousTx.transaction.outputs[Number(previousOutput.index)].lock,
        );
        const data: BurnDbData = {
          senderAddress: senderAddress,
          cellData: cellData,
        };
        burnTxs.set(tx.hash, data);
        logger.info(
          `CkbHandler watchBurnEvents receive burnedTx, ckbTxHash:${
            tx.hash
          } senderAddress:${senderAddress} cellData:${JSON.stringify(cellData, null, 2)}`,
        );
      }
    }
    await this.onBurnTxs(blockNumber, burnTxs);
    await this.setLastHandledBlock(blockNumber, blockHash);
  }

  async onMintTx(mintedRecords: MintedRecords): Promise<UpdateResult | undefined> {
    if (this.role === 'collector') {
      await this.db.updateCkbMintStatus(mintedRecords.txHash, 'success');
      return;
    }
    await this.db.watcherCreateMint(mintedRecords);
    await this.db.updateBridgeInRecords(mintedRecords);
  }

  async onBurnTxs(latestHeight: number, burnTxs: Map<string, BurnDbData>): Promise<void> {
    if (burnTxs.size === 0) {
      return;
    }
    const burnTxHashes: string[] = [];
    const ckbBurns: ICkbBurn[] = [];
    burnTxs.forEach((v: BurnDbData, k: string) => {
      const chain = v.cellData.getChain();
      let burn: ICkbBurn | undefined;
      switch (chain) {
        case ChainType.BTC:
        case ChainType.TRON:
        case ChainType.ETH:
        case ChainType.EOS: {
          const asset = uint8ArrayToString(new Uint8Array(v.cellData.getAsset().raw()));
          burn = {
            senderAddress: v.senderAddress,
            ckbTxHash: k,
            asset: asset,
            chain,
            amount: Amount.fromUInt128LE(`0x${toHexString(new Uint8Array(v.cellData.getAmount().raw()))}`).toString(0),
            bridgeFee: this.role === 'collector' ? new EthAsset(asset).getBridgeFee('out') : '0',
            recipientAddress: uint8ArrayToString(new Uint8Array(v.cellData.getRecipientAddress().raw())),
            blockNumber: latestHeight,
            confirmStatus: 'unconfirmed',
          };
          break;
        }
      }
      if (burn) {
        BridgeMetricSingleton.getInstance(this.role).addBridgeTxMetrics('ckb_burn', 'success');
        BridgeMetricSingleton.getInstance(this.role).addBridgeTokenMetrics('ckb_burn', [
          {
            token: burn.asset,
            amount: Number(burn.amount),
          },
        ]);
      }

      asserts(burn);

      ckbBurns.push(burn);
      burnTxHashes.push(k);
    });
    await this.db.createCkbBurn(ckbBurns);
    if (this.role === 'watcher') {
      await this.db.updateBurnBridgeFee(ckbBurns);
    }
    logger.info(`CkbHandler processBurnTxs saveBurnEvent success, burnTxHashes:${burnTxHashes.join(', ')}`);
  }

  async parseMintTx(tx: Transaction): Promise<null | MintedRecords> {
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
    const parsedResult = new Array(0);
    mintedSudtCellIndexes.forEach((value, index) => {
      const amount = Amount.fromUInt128LE(tx.outputsData[value]);
      const lockTxHash = uint8ArrayToString(new Uint8Array(lockTxHashes.indexAt(index).raw()));
      parsedResult.push({ amount: amount, lockTxHash: lockTxHash });
    });
    return { txHash: tx.hash, records: parsedResult };
  }

  handleMintRecords(): void {
    if (this.role !== 'collector') {
      return;
    }
    const ownerTypeHash = getOwnerTypeHash();
    const generator = new CkbTxGenerator(this.ckb, this.ckbIndexer);

    this.handlePendingMintRecords(ownerTypeHash, generator).then(
      () => {
        this.handleTodoMintRecords(ownerTypeHash, generator);
      },
      (err) => {
        logger.error(`handlePendingMintRecords error:${err.message}`);
      },
    );
  }

  async handlePendingMintRecords(ownerTypeHash: string, generator: CkbTxGenerator): Promise<void> {
    for (;;) {
      try {
        const mintRecords = await this.db.getCkbMintRecordsToMint('pending');
        await this.doHandleMintRecords(mintRecords, ownerTypeHash, generator);
        break;
      } catch (e) {
        logger.error(`handlePendingMintRecords getUnlockRecords error:${e.message}`);
        await asyncSleep(3000);
      }
    }
  }

  handleTodoMintRecords(ownerTypeHash: string, generator: CkbTxGenerator): void {
    foreverPromise(
      async () => {
        const mintRecords = await this.db.getCkbMintRecordsToMint('todo');
        if (mintRecords.length == 0) {
          logger.debug('wait for new mint records');
          await asyncSleep(3000);
          return;
        }
        logger.info(`CkbHandler handleMintRecords new mintRecords:${JSON.stringify(mintRecords, null, 2)}`);
        await this.ckbIndexer.waitForSync();
        await this.doHandleMintRecords(mintRecords, ownerTypeHash, generator);
      },
      { onRejectedInterval: 0, onResolvedInterval: 0 },
    );
  }

  async doHandleMintRecords(mintRecords: CkbMint[], ownerTypeHash: string, generator: CkbTxGenerator): Promise<void> {
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
        `CkbHandler doHandleMintRecords bridge cell is not exist. do create bridge cell. ownerTypeHash:${ownerTypeHash.toString()}`,
      );
      logger.info(`CkbHandler doHandleMintRecords createBridgeCell newToken:${JSON.stringify(newTokens, null, 2)}`);
      await this.waitUntilSync();
      await this.createBridgeCell(newTokens, generator);
    }

    for (;;) {
      try {
        mintRecords.map((r) => {
          r.status = 'pending';
        });
        await this.db.updateCkbMint(mintRecords);
        await this.waitUntilSync();
        break;
      } catch (e) {
        logger.error(`CkbHandler doHandleMintRecords prepare error:${e.message}`);
        await asyncSleep(3000);
      }
    }

    const txSkeleton = await generator.mint(records, this.ckbIndexer);
    logger.info(`mint tx txSkeleton ${JSON.stringify(txSkeleton, null, 2)}`);
    const sigs = await this.collectMintSignatures(txSkeleton, mintRecords);
    for (;;) {
      try {
        if (sigs.length < ForceBridgeCore.config.ckb.multisigScript.M) {
          const mintTxHash = txSkeleton.get('signingEntries').get(1)!.message;
          mintRecords.map((r) => {
            r.status = 'error';
            r.message = `sig number:${sigs.length} less than:${ForceBridgeCore.config.ckb.multisigScript.M}`;
            r.mintHash = mintTxHash;
          });
          logger.error(
            `CkbHandler doHandleMintRecords sig number:${sigs.length} less than:${ForceBridgeCore.config.ckb.multisigScript.M}, mintIds:${mintIds}`,
          );
          break;
        }

        const content0 = key.signRecoverable(
          txSkeleton.get('signingEntries').get(0)!.message,
          ForceBridgeCore.config.ckb.fromPrivateKey,
        );
        let content1 = serializeMultisigScript(ForceBridgeCore.config.ckb.multisigScript);
        content1 += sigs.join('');

        const tx = sealTransaction(txSkeleton, [content0, content1]);
        const mintTxHash = await this.transactionManager.send_transaction(tx);
        logger.info(
          `CkbHandler doHandleMintRecords Mint Transaction has been sent, ckbTxHash ${mintTxHash}, mintIds:${mintIds}`,
        );

        const txStatus = await this.waitUntilCommitted(mintTxHash, 200);
        if (txStatus.txStatus.status === 'committed') {
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
          logger.error(
            `CkbHandler doHandleMintRecords mint execute failed txStatus:${txStatus.txStatus.status}, mintIds:${mintIds}`,
          );
          BridgeMetricSingleton.getInstance(this.role).addBridgeTxMetrics('ckb_mint', 'failed');
          mintRecords.map((r) => {
            r.status = 'error';
            r.mintHash = mintTxHash;
            r.message = 'mint execute failed';
          });
        }
        break;
      } catch (e) {
        logger.debug(`CkbHandler doHandleMintRecords mint error:${e.toString()}, mintIds:${mintIds}`);
        await asyncSleep(3000);
      }
    }

    for (;;) {
      try {
        await this.db.updateCkbMint(mintRecords);
        logger.info('CkbHandler doHandleMintRecords mint execute completed, mintIds:', mintIds);
        break;
      } catch (e) {
        logger.error(`CkbHandler doHandleMintRecords db.updateCkbMint mintIds:${mintIds} error:${e.message}`);
      }
    }
  }

  async collectMintSignatures(txSkeleton: TransactionSkeletonType, mintRecords: CkbMint[]): Promise<string[]> {
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
          };
        }),
        txSkeleton,
      },
    });
  }

  filterMintRecords(r: CkbMint, ownerTypeHash: string): MintAssetRecord {
    switch (r.chain) {
      case ChainType.BTC:
        return {
          lockTxHash: r.id,
          asset: new BtcAsset(r.asset, ownerTypeHash),
          recipient: new Address(r.recipientLockscript, AddressType.ckb),
          amount: new Amount(r.amount, 0),
        };
      case ChainType.ETH:
        return {
          lockTxHash: r.id,
          asset: new EthAsset(r.asset, ownerTypeHash),
          recipient: new Address(r.recipientLockscript, AddressType.ckb),
          amount: new Amount(r.amount, 0),
        };
      case ChainType.TRON:
        return {
          lockTxHash: r.id,
          asset: new TronAsset(r.asset, ownerTypeHash),
          amount: new Amount(r.amount, 0),
          recipient: new Address(r.recipientLockscript, AddressType.ckb),
        };
      case ChainType.EOS:
        return {
          lockTxHash: r.id,
          asset: new EosAsset(r.asset, ownerTypeHash),
          amount: new Amount(r.amount, 0),
          recipient: new Address(r.recipientLockscript, AddressType.ckb),
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
        codeHash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
        hashType: ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
        args: record.asset.toBridgeLockscriptArgs(),
      };
      logger.debug('CkbHandler filterNewTokens bridgeCellLockscript ', bridgeCellLockscript);
      const searchKey = {
        script: new Script(
          bridgeCellLockscript.codeHash,
          bridgeCellLockscript.args,
          <HashType>bridgeCellLockscript.hashType,
        ).serializeJson() as LumosScript,
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
      return new Script(
        ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
        r.asset.toBridgeLockscriptArgs(),
        ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
      );
    });

    const txSkeleton = await generator.createBridgeCell(scripts, this.ckbIndexer);
    const message0 = txSkeleton.get('signingEntries').get(0)!.message;
    const content0 = key.signRecoverable(message0, ForceBridgeCore.config.ckb.fromPrivateKey);
    let content1 = serializeMultisigScript(ForceBridgeCore.config.ckb.multisigScript);
    const sigs = await this.multisigMgr.collectSignatures({
      rawData: txSkeleton.get('signingEntries').get(1)!.message,
      payload: {
        sigType: 'create_cell',
        createAssets: assets,
        txSkeleton,
      },
    });
    content1 += sigs.join('');

    const tx = sealTransaction(txSkeleton, [content0, content1]);
    logger.info('tx:', JSON.stringify(tx, null, 2));
    const txHash = await this.transactionManager.send_transaction(tx);
    await this.waitUntilCommitted(txHash, 60);
  }

  async waitUntilSync(): Promise<void> {
    for (;;) {
      try {
        const ckbRpc = new RPC(ForceBridgeCore.config.ckb.ckbRpcUrl);
        const rpcTipNumber = parseInt((await ckbRpc.get_tip_header()).number, 16);
        logger.debug('rpcTipNumber', rpcTipNumber);
        let index = 0;
        for (;;) {
          const indexerTipNumber = parseInt((await this.ckbIndexer.tip()).block_number, 16);
          logger.debug('indexerTipNumber', indexerTipNumber);
          if (indexerTipNumber >= rpcTipNumber) {
            return;
          }
          logger.debug(`wait until indexer sync. index: ${index++}`);
          await asyncSleep(1000);
        }
      } catch (e) {
        logger.error(`CkbHandler waitUntilSync error:${e.message}`);
        await asyncSleep(3000);
      }
    }
  }

  async waitUntilCommitted(txHash: string, timeout: number): Promise<TransactionWithStatus> {
    let waitTime = 0;
    const statusMap = new Map<string, boolean>();

    for (;;) {
      try {
        const txStatus = await this.ckb.rpc.getTransaction(txHash);
        if (!statusMap.get(txStatus.txStatus.status)) {
          logger.info(
            `CkbHandler waitUntilCommitted tx ${txHash} status: ${txStatus.txStatus.status}, index: ${waitTime}`,
          );
          statusMap.set(txStatus.txStatus.status, true);
        }
        if (txStatus.txStatus.status === 'committed') {
          return txStatus;
        }
        await asyncSleep(1000);
        waitTime += 1;
        if (waitTime >= timeout) {
          return txStatus;
        }
      } catch (e) {
        logger.error(`CkbHandler waitUntilCommitted error:${e.message}`);
        await asyncSleep(3000);
      }
    }
  }

  start(): void {
    this.watchNewBlock();
    this.handleMintRecords();
    logger.info('ckb handler started 🚀');
  }
}

function isTypeIDCorrect(args: string): boolean {
  const expectOwnerTypeHash = getOwnerTypeHash();
  const bridgeLockArgs = new ForceBridgeLockscriptArgs(fromHexString(args).buffer);
  const ownerTypeHash = `0x${toHexString(new Uint8Array(bridgeLockArgs.getOwnerCellTypeHash().raw()))}`;
  return ownerTypeHash === expectOwnerTypeHash;
}

export async function isBurnTx(tx: Transaction, cellData: RecipientCellData): Promise<boolean> {
  if (tx.outputs.length < 1) {
    return false;
  }
  const ownerTypeHash = getOwnerTypeHash();
  logger.debug('amount: ', toHexString(new Uint8Array(cellData.getAmount().raw())));
  logger.debug('recipient address: ', toHexString(new Uint8Array(cellData.getRecipientAddress().raw())));
  logger.debug('asset: ', toHexString(new Uint8Array(cellData.getAsset().raw())));
  logger.debug('chain: ', cellData.getChain());
  let asset;
  const assetAddress = toHexString(new Uint8Array(cellData.getAsset().raw()));
  switch (cellData.getChain()) {
    case ChainType.BTC:
      asset = new BtcAsset(uint8ArrayToString(fromHexString(assetAddress)), ownerTypeHash);
      break;
    case ChainType.ETH:
      asset = new EthAsset(uint8ArrayToString(fromHexString(assetAddress)), ownerTypeHash);
      break;
    case ChainType.TRON:
      asset = new TronAsset(uint8ArrayToString(fromHexString(assetAddress)), ownerTypeHash);
      break;
    case ChainType.EOS:
      asset = new EosAsset(uint8ArrayToString(fromHexString(assetAddress)), ownerTypeHash);
      break;
    default:
      return false;
  }

  if (
    !asset.inWhiteList() ||
    Amount.fromUInt128LE(`0x${toHexString(new Uint8Array(cellData.getAmount().raw()))}`).lt(
      new Amount(asset.getMinimalAmount(), 0),
    )
  )
    return false;

  // verify tx output: recipient cell.
  const recipientTypescript = nonNullable(tx.outputs[0].type);
  const recipientCellOwnerTypeHash = `0x${toHexString(new Uint8Array(cellData.getOwnerCellTypeHash().raw()))}`;
  const expectRecipientTypescript = ForceBridgeCore.config.ckb.deps.recipientType.script;
  logger.debug('recipientScript:', recipientTypescript);
  logger.debug('expect:', expectRecipientTypescript);
  return (
    recipientTypescript.codeHash === expectRecipientTypescript.codeHash &&
    recipientTypescript.hashType == expectRecipientTypescript.hashType &&
    recipientCellOwnerTypeHash === ownerTypeHash
  );
}

type BurnDbData = {
  cellData: RecipientCellData;
  senderAddress: string;
};
