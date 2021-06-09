import { Script as LumosScript } from '@ckb-lumos/base';
import { serializeMultisigScript } from '@ckb-lumos/common-scripts/lib/secp256k1_blake160_multisig';
import { key } from '@ckb-lumos/hd';
import { sealTransaction } from '@ckb-lumos/helpers';
import { RPC } from '@ckb-lumos/rpc';
import TransactionManager from '@ckb-lumos/transaction-manager';
import { Address, AddressType, Amount, HashType, Script } from '@lay2/pw-core';
import CKB from '@nervosnetwork/ckb-sdk-core';
import { Account } from '../ckb/model/accounts';
import { Asset, BtcAsset, ChainType, EosAsset, EthAsset, TronAsset } from '../ckb/model/asset';
import { RecipientCellData } from '../ckb/tx-helper/generated/eth_recipient_cell';
import { CkbTxGenerator, MintAssetRecord } from '../ckb/tx-helper/generator';
import { ScriptType } from '../ckb/tx-helper/indexer';
import { getOwnLockHash } from '../ckb/tx-helper/multisig/multisig_helper';
import { forceBridgeRole } from '../config';
import { ForceBridgeCore } from '../core';
import { CkbDb } from '../db';
import { CkbMint, ICkbBurn } from '../db/model';
import { asserts, nonNullable } from '../errors';
import { createAsset, MultiSigMgr } from '../multisig/multisig-mgr';
import { asyncSleep, fromHexString, toHexString, uint8ArrayToString } from '../utils';
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

  constructor(private db: CkbDb, private kvDb, private role: forceBridgeRole) {
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

  async onCkbBurnConfirmed(confirmedCkbBurns: ICkbBurn[]) {
    for (const burn of confirmedCkbBurns) {
      logger.info(`CkbHandler onCkbBurnConfirmed burnRecord:${JSON.stringify(burn, undefined, 2)}`);
      switch (burn.chain) {
        case ChainType.BTC:
          await this.db.createBtcUnlock([
            {
              ckbTxHash: burn.ckbTxHash,
              asset: burn.asset,
              amount: new Amount(burn.amount, 0).sub(new Amount(burn.bridgeFee, 0)).toString(0),
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
              amount: new Amount(burn.amount, 0).sub(new Amount(burn.bridgeFee, 0)).toString(0),
              recipientAddress: burn.recipientAddress,
            },
          ]);
          break;
        case ChainType.EOS:
          await this.db.createEosUnlock([
            {
              ckbTxHash: burn.ckbTxHash,
              asset: burn.asset,
              amount: new Amount(burn.amount, 0).sub(new Amount(burn.bridgeFee, 0)).toString(0),
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
              amount: new Amount(burn.amount, 0).sub(new Amount(burn.bridgeFee, 0)).toString(0),
              recipientAddress: burn.recipientAddress,
            },
          ]);
          break;
        default:
          throw new Error(`wrong burn chain type: ${burn.chain}`);
      }
    }
  }

  async watchNewBlock() {
    const lastHandledBlock = await this.getLastHandledBlock();
    if (lastHandledBlock.blockNumber === 0) {
      const currentBlock = await this.ckb.rpc.getTipHeader();
      this.lastHandledBlockHeight = Number(currentBlock.number);
      this.lastHandledBlockHash = currentBlock.hash;
    } else {
      this.lastHandledBlockHeight = lastHandledBlock.blockNumber;
      this.lastHandledBlockHash = lastHandledBlock.blockHash;
    }

    for (;;) {
      const nextBlockHeight = this.lastHandledBlockHeight + 1;
      const block = await this.ckb.rpc.getBlockByNumber(BigInt(nextBlockHeight));
      if (block == null) {
        await asyncSleep(5000);
        continue;
      }
      await this.onBlock(block);
    }
  }

  async onBlock(block: Block) {
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
      if (await this.isMintTx(tx)) {
        await this.onMintTx(tx);
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

  async onMintTx(tx: Transaction) {
    if (this.role !== 'collector') {
      return;
    }
    await this.db.updateCkbMintStatus(tx.hash, 'success');
  }

  async onBurnTxs(latestHeight: number, burnTxs: Map<string, BurnDbData>) {
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
            bridgeFee: new EthAsset(asset).getBridgeFee('out'),
            recipientAddress: uint8ArrayToString(new Uint8Array(v.cellData.getRecipientAddress().raw())),
            blockNumber: latestHeight,
            confirmStatus: 'unconfirmed',
          };
          break;
        }
      }

      asserts(burn);

      ckbBurns.push(burn);
      burnTxHashes.push(k);
    });
    await this.db.createCkbBurn(ckbBurns);
    logger.info(`CkbHandler processBurnTxs saveBurnEvent success, burnTxHashes:${burnTxHashes.join(', ')}`);
  }

  async isMintTx(tx: Transaction): Promise<boolean> {
    if (tx.outputs.length < 1 || !tx.outputs[0].type) {
      return false;
    }
    const firstOutputTypeCodeHash = tx.outputs[0].type.codeHash;
    const expectSudtTypeCodeHash = ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash;
    // verify tx output sudt cell
    if (firstOutputTypeCodeHash != expectSudtTypeCodeHash) {
      return false;
    }
    const committeeLockHash = getOwnLockHash(ForceBridgeCore.config.ckb.multisigScript);
    // verify tx input: committee cell.
    const previousOutput = nonNullable(tx.inputs[0].previousOutput);
    const preHash = previousOutput.txHash;
    const txPrevious = await this.ckb.rpc.getTransaction(preHash);
    if (txPrevious == null) {
      return false;
    }
    const firstInputLock = txPrevious.transaction.outputs[Number(previousOutput.index)].lock;
    const firstInputLockHash = this.ckb.utils.scriptToHash(<CKBComponents.Script>firstInputLock);

    logger.info(
      `CkbHandler isMintTx tx ${tx.hash} sender lock hash is ${firstInputLockHash}. first output type code hash is ${firstOutputTypeCodeHash}.`,
    );
    return firstInputLockHash === committeeLockHash;
  }

  async handleMintRecords(): Promise<void> {
    if (this.role !== 'collector') {
      return;
    }
    const ownLockHash = getOwnLockHash(ForceBridgeCore.config.ckb.multisigScript);
    const generator = new CkbTxGenerator(this.ckb, this.ckbIndexer);
    while (true) {
      const mintRecords = await this.db.getCkbMintRecordsToMint();
      if (mintRecords.length == 0) {
        logger.debug('wait for new mint records');
        await asyncSleep(3000);
        continue;
      }
      logger.info(`CkbHandler handleMintRecords new mintRecords:${JSON.stringify(mintRecords, null, 2)}`);

      await this.ckbIndexer.waitForSync();
      const mintIds = mintRecords
        .map((ckbMint) => {
          return ckbMint.id;
        })
        .join(', ');

      const records = mintRecords.map((r) => this.filterMintRecords(r, ownLockHash));
      const newTokens = await this.filterNewTokens(records);
      if (newTokens.length > 0) {
        logger.info(
          `CkbHandler handleMintRecords bridge cell is not exist. do create bridge cell. ownLockHash:${ownLockHash.toString()}`,
        );
        logger.info(`CkbHandler handleMintRecords createBridgeCell newToken:${JSON.stringify(newTokens, null, 2)}`);
        await this.waitUntilSync();
        await this.createBridgeCell(newTokens, generator);
      }

      try {
        mintRecords.map((r) => {
          r.status = 'pending';
        });
        await this.db.updateCkbMint(mintRecords);
        await this.waitUntilSync();
        const txSkeleton = await generator.mint(records, this.ckbIndexer);
        logger.info(`mint tx txSkeleton ${JSON.stringify(txSkeleton, null, 2)}`);
        const content0 = key.signRecoverable(
          txSkeleton.get('signingEntries').get(0)!.message,
          ForceBridgeCore.config.ckb.fromPrivateKey,
        );
        let content1 = serializeMultisigScript(ForceBridgeCore.config.ckb.multisigScript);

        const sigs = await this.multisigMgr.collectSignatures({
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
        content1 += sigs.join('');

        const tx = sealTransaction(txSkeleton, [content0, content1]);
        const mintTxHash = await this.transactionManager.send_transaction(tx);
        logger.info(
          `CkbHandler handleMintRecords Mint Transaction has been sent, ckbTxHash ${mintTxHash}, mintIds:${mintIds}`,
        );
        const txStatus = await this.waitUntilCommitted(mintTxHash, 200);
        if (txStatus.txStatus.status === 'committed') {
          mintRecords.map((r) => {
            r.status = 'success';
            r.mintHash = mintTxHash;
          });
        } else {
          mintRecords.map((r) => {
            r.mintHash = mintTxHash;
          });
          logger.error(
            `CkbHandler handleMintRecords mint execute failed txStatus:${txStatus.txStatus.status}, mintIds:${mintIds}`,
          );
        }
        await this.db.updateCkbMint(mintRecords);
        logger.info('CkbHandler handleMintRecords mint execute completed, mintIds:', mintIds);
      } catch (e) {
        logger.debug(`CkbHandler handleMintRecords mint error:${e.toString()}, mintIds:${mintIds}`);
        mintRecords.map((r) => {
          r.status = 'error';
          r.message = e.toString();
        });
        await this.db.updateCkbMint(mintRecords);
      }
    }
  }

  filterMintRecords(r: CkbMint, ownLockHash: string): MintAssetRecord {
    switch (r.chain) {
      case ChainType.BTC:
        return {
          asset: new BtcAsset(r.asset, ownLockHash),
          recipient: new Address(r.recipientLockscript, AddressType.ckb),
          amount: new Amount(r.amount, 0),
        };
      case ChainType.ETH:
        return {
          asset: new EthAsset(r.asset, ownLockHash),
          recipient: new Address(r.recipientLockscript, AddressType.ckb),
          amount: new Amount(r.amount, 0),
        };
      case ChainType.TRON:
        return {
          asset: new TronAsset(r.asset, ownLockHash),
          amount: new Amount(r.amount, 0),
          recipient: new Address(r.recipientLockscript, AddressType.ckb),
        };
      case ChainType.EOS:
        return {
          asset: new EosAsset(r.asset, ownLockHash),
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

  async createBridgeCell(newTokens: MintAssetRecord[], generator: CkbTxGenerator) {
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
    console.log('tx:', JSON.stringify(tx, null, 2));
    const txHash = await this.transactionManager.send_transaction(tx);
    await this.waitUntilCommitted(txHash, 60);
  }

  async waitUntilSync(): Promise<void> {
    const ckbRpc = new RPC(ForceBridgeCore.config.ckb.ckbRpcUrl);
    const rpcTipNumber = parseInt((await ckbRpc.get_tip_header()).number, 16);
    logger.debug('rpcTipNumber', rpcTipNumber);
    let index = 0;
    while (true) {
      const indexerTipNumber = parseInt((await this.ckbIndexer.tip()).block_number, 16);
      logger.debug('indexerTipNumber', indexerTipNumber);
      if (indexerTipNumber >= rpcTipNumber) {
        return;
      }
      logger.debug(`wait until indexer sync. index: ${index++}`);
      await asyncSleep(1000);
    }
  }

  getBridgeLockHash(asset: Asset): string {
    const bridgeCellLockscript = {
      codeHash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
      hashType: ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
      args: asset.toBridgeLockscriptArgs(),
    };
    const bridgeLockHash = this.ckb.utils.scriptToHash(<CKBComponents.Script>bridgeCellLockscript);
    return bridgeLockHash;
  }

  async waitUntilCommitted(txHash: string, timeout: number) {
    let waitTime = 0;
    const statusMap = new Map<string, boolean>();

    while (true) {
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
    }
  }

  start(): void {
    this.watchNewBlock();
    this.handleMintRecords();
    logger.info('ckb handler started 🚀');
  }
}

export async function isBurnTx(tx: Transaction, cellData: RecipientCellData): Promise<boolean> {
  if (tx.outputs.length < 1) {
    return false;
  }
  const ownLockHash = getOwnLockHash(ForceBridgeCore.config.ckb.multisigScript);
  logger.debug('amount: ', toHexString(new Uint8Array(cellData.getAmount().raw())));
  logger.debug('recipient address: ', toHexString(new Uint8Array(cellData.getRecipientAddress().raw())));
  logger.debug('asset: ', toHexString(new Uint8Array(cellData.getAsset().raw())));
  logger.debug('chain: ', cellData.getChain());
  let asset;
  const assetAddress = toHexString(new Uint8Array(cellData.getAsset().raw()));
  switch (cellData.getChain()) {
    case ChainType.BTC:
      asset = new BtcAsset(uint8ArrayToString(fromHexString(assetAddress)), ownLockHash);
      break;
    case ChainType.ETH:
      asset = new EthAsset(uint8ArrayToString(fromHexString(assetAddress)), ownLockHash);
      break;
    case ChainType.TRON:
      asset = new TronAsset(uint8ArrayToString(fromHexString(assetAddress)), ownLockHash);
      break;
    case ChainType.EOS:
      asset = new EosAsset(uint8ArrayToString(fromHexString(assetAddress)), ownLockHash);
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

  // verify tx input: sudt cell.
  const previousOutput = nonNullable(tx.inputs[0].previousOutput);

  const preHash = previousOutput.txHash;
  const txPrevious = await ForceBridgeCore.ckb.rpc.getTransaction(preHash);
  if (txPrevious == null) {
    return false;
  }
  const sudtType = txPrevious.transaction.outputs[Number(previousOutput.index)].type;
  const bridgeCellLockscript = {
    codeHash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
    hashType: ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
    args: asset.toBridgeLockscriptArgs(),
  };
  const bridgeLockHash = ForceBridgeCore.ckb.utils.scriptToHash(<CKBComponents.Script>bridgeCellLockscript);
  const expectType = {
    codeHash: ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash,
    hashType: ForceBridgeCore.config.ckb.deps.sudtType.script.hashType,
    args: bridgeLockHash,
  };
  logger.debug('expectType:', expectType);
  logger.debug('sudtType:', sudtType);
  if (sudtType == null || expectType.codeHash != sudtType.codeHash || expectType.args != sudtType.args) {
    return false;
  }

  // verify tx output recipientLockscript: recipient cell.
  const recipientScript = nonNullable(tx.outputs[0].type);
  const expect = ForceBridgeCore.config.ckb.deps.recipientType.script;
  logger.debug('recipientScript:', recipientScript);
  logger.debug('expect:', expect);
  return recipientScript.codeHash == expect.codeHash;
}

type BurnDbData = {
  cellData: RecipientCellData;
  senderAddress: string;
};
