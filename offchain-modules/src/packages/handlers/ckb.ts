import { CkbDb } from '../db';
import { CkbMint, ICkbBurn } from '../db/model';
import { logger } from '../utils/logger';
import { asyncSleep, fromHexString, toHexString, uint8ArrayToString } from '../utils';
import { Asset, BtcAsset, ChainType, EosAsset, EthAsset, TronAsset } from '../ckb/model/asset';
import { Address, AddressType, Amount, HashType, Script } from '@lay2/pw-core';
import { getAssetTypeByAsset } from '@force-bridge/xchain/tron/utils';
import { Account } from '@force-bridge/ckb/model/accounts';
import { CkbTxGenerator, MintAssetRecord } from '@force-bridge/ckb/tx-helper/generator';
import { IndexerCollector } from '@force-bridge/ckb/tx-helper/collector';
import { ScriptType } from '@force-bridge/ckb/tx-helper/indexer';
import { ForceBridgeCore } from '@force-bridge/core';
import { Script as LumosScript } from '@ckb-lumos/base';
import { RecipientCellData } from '@force-bridge/ckb/tx-helper/generated/eth_recipient_cell';
import { Indexer } from '@ckb-lumos/indexer';
import { sealTransaction } from '@ckb-lumos/helpers';
import { key } from '@ckb-lumos/hd';
import TransactionManager from '@ckb-lumos/transaction-manager';
import { RPC } from '@ckb-lumos/rpc';

import Transaction = CKBComponents.Transaction;
import TransactionWithStatus = CKBComponents.TransactionWithStatus;
import { serializeMultisigScript } from '@ckb-lumos/common-scripts/lib/secp256k1_blake160_multisig';
import { getMultisigLock, getOwnLockHash } from '@force-bridge/ckb/tx-helper/multisig/multisig_helper';
import { JSONRPCClient } from 'json-rpc-2.0';
import fetch from 'node-fetch/index';
import { MultiSigMgr } from '@force-bridge/multisig/multisig-mgr';

const lumosIndexerData = './indexer-data';
// CKB handler
// 1. Listen CKB chain to get new burn events.
// 2. Listen database to get new mint events, send tx.
export class CkbHandler {
  private ckb;
  private indexer;
  private ckbIndexer;
  private transactionManager;
  private multisigMgr;
  constructor(private db: CkbDb) {
    this.ckb = ForceBridgeCore.ckb;
    this.indexer = new Indexer(ForceBridgeCore.config.ckb.ckbRpcUrl, lumosIndexerData);
    this.ckbIndexer = ForceBridgeCore.ckbIndexer;
    this.indexer.startForever();
    this.transactionManager = new TransactionManager(this.indexer);
    this.multisigMgr = new MultiSigMgr(
      'CKB',
      ForceBridgeCore.config.ckb.hosts,
      ForceBridgeCore.config.ckb.multisigScript.M,
    );
  }

  // save unlock event first and then
  async saveBurnEvent(burns: ICkbBurn[]): Promise<void> {
    logger.debug('CkbHandler saveBurnEvent:', burns);
    for (const burn of burns) {
      switch (burn.chain) {
        case ChainType.BTC:
          await this.db.createBtcUnlock([
            {
              ckbTxHash: burn.ckbTxHash,
              asset: burn.asset,
              amount: burn.amount,
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
              amount: burn.amount,
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
              amount: burn.amount,
              recipientAddress: burn.recipientAddress,
            },
          ]);
          break;
        case ChainType.EOS:
          await this.db.createEosUnlock([
            {
              ckbTxHash: burn.ckbTxHash,
              asset: burn.asset,
              amount: burn.amount,
              recipientAddress: burn.recipientAddress,
            },
          ]);
          break;
        default:
          throw new Error(`wrong burn chain type: ${burn.chain}`);
      }
      await this.db.createCkbBurn([burn]);
    }
  }

  async watchBurnEvents(): Promise<never> {
    // get cursor from db, usually the block height, to start the poll or subscribe
    // invoke saveBurnEvent when get new one
    let latestHeight = await this.db.getCkbLatestHeight();
    while (true) {
      logger.debug('CkbHandler watchBurnEvents height: ', latestHeight);
      const block = await this.ckb.rpc.getBlockByNumber(BigInt(latestHeight));
      if (block == null) {
        logger.debug('watchBurnEvents watchBurnEvents waiting for new ckb block');
        await asyncSleep(5000);
        continue;
      }
      const burnTxs = new Map();
      for (const tx of block.transactions) {
        if (await this.isMintTx(tx)) {
          const pendingMintTxs = await this.db.getMintRecordsToUpdate(tx.hash);
          pendingMintTxs.map((r) => {
            r.status = 'success';
          });
          await this.db.updateCkbMint(pendingMintTxs);
        }
        const recipientData = tx.outputsData[0];
        let cellData;
        try {
          cellData = new RecipientCellData(fromHexString(recipientData).buffer);
        } catch (e) {
          continue;
        }
        if (await isBurnTx(tx, cellData)) {
          const burnPreviousTx: TransactionWithStatus = await this.ckb.rpc.getTransaction(
            tx.inputs[0].previousOutput.txHash,
          );
          const senderLockHash = this.ckb.utils.scriptToHash(
            burnPreviousTx.transaction.outputs[Number(tx.inputs[0].previousOutput.index)].lock,
          );
          const data: BurnDbData = {
            senderLockScriptHash: senderLockHash,
            cellData: cellData,
          };
          burnTxs.set(tx.hash, data);
          logger.info(
            `CkbHandler watchBurnEvents receive burnedTx, ckbTxHash:${
              tx.hash
            } senderLockHash:${senderLockHash} cellData:${JSON.stringify(cellData, null, 2)}`,
          );
        }
      }

      const burnTxHashes = [];
      if (burnTxs.size > 0) {
        const ckbBurns = [];
        burnTxs.forEach((v: BurnDbData, k: string) => {
          const chain = v.cellData.getChain();
          let burn: ICkbBurn;
          switch (chain) {
            case ChainType.BTC:
            case ChainType.TRON:
            case ChainType.ETH:
            case ChainType.EOS:
              burn = {
                senderLockHash: v.senderLockScriptHash,
                ckbTxHash: k,
                asset: uint8ArrayToString(new Uint8Array(v.cellData.getAsset().raw())),
                chain,
                amount: Amount.fromUInt128LE(`0x${toHexString(new Uint8Array(v.cellData.getAmount().raw()))}`).toString(
                  0,
                ),
                recipientAddress: uint8ArrayToString(new Uint8Array(v.cellData.getRecipientAddress().raw())),
                blockNumber: latestHeight,
              };
              break;
          }
          ckbBurns.push(burn);
          burnTxHashes.push(k);
        });
        await this.saveBurnEvent(ckbBurns);
        logger.info(`CkbHandler watchBurnEvents saveBurnEvent success, burnTxHashes:${burnTxHashes.join(', ')}`);
      }
      latestHeight++;
      await asyncSleep(1000);
    }
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
    const preHash = tx.inputs[0].previousOutput.txHash;
    const txPrevious = await this.ckb.rpc.getTransaction(preHash);
    if (txPrevious == null) {
      return false;
    }
    const firstInputLock = txPrevious.transaction.outputs[Number(tx.inputs[0].previousOutput.index)].lock;
    const firstInputLockHash = this.ckb.utils.scriptToHash(<CKBComponents.Script>firstInputLock);

    logger.info(
      `CkbHandler isMintTx tx ${tx.hash} sender lock hash is ${firstInputLockHash}. first output type code hash is ${firstOutputTypeCodeHash}.`,
    );
    return firstInputLockHash === committeeLockHash;
  }

  async handleMintRecords(): Promise<never> {
    const ownLockHash = getOwnLockHash(ForceBridgeCore.config.ckb.multisigScript);
    const generator = new CkbTxGenerator(this.ckb, new IndexerCollector(this.indexer));
    while (true) {
      const mintRecords = await this.db.getCkbMintRecordsToMint();
      if (mintRecords.length == 0) {
        logger.debug('wait for new mint records');
        await asyncSleep(3000);
        continue;
      }
      logger.info(`CkbHandler handleMintRecords new mintRecords:${JSON.stringify(mintRecords, null, 2)}`);

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
        const txSkeleton = await generator.mint(records, this.indexer);
        logger.info(`mint tx txSkeleton ${JSON.stringify(txSkeleton, null, 2)}`);
        const content0 = key.signRecoverable(
          txSkeleton.get('signingEntries').get(0).message,
          ForceBridgeCore.config.ckb.fromPrivateKey,
        );
        let content1 = serializeMultisigScript(ForceBridgeCore.config.ckb.multisigScript);

        const sigs = await this.multisigMgr.collectSignatures({
          rawData: txSkeleton.get('signingEntries').get(1).message,
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
        const txStatus = await this.waitUntilCommitted(mintTxHash, 60);
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
    const newTokens = [];
    const assets = [];
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
    const assets = [];
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

    const txSkeleton = await generator.createBridgeCell(scripts, this.indexer);
    logger.info(`signingEntries length:, ${JSON.stringify(txSkeleton, null, 2)}`);
    const message0 = txSkeleton.get('signingEntries').get(0).message;
    const content0 = key.signRecoverable(message0, ForceBridgeCore.config.ckb.fromPrivateKey);
    let content1 = serializeMultisigScript(ForceBridgeCore.config.ckb.multisigScript);
    const sigs = await this.multisigMgr.collectSignatures({
      rawData: txSkeleton.get('signingEntries').get(1).message,
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
      const indexerTipNumber = parseInt((await this.indexer.tip()).block_number, 16);
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
    let statusMap = new Map<string, boolean>();

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
    this.watchBurnEvents();
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

  // verify tx input: sudt cell.
  const preHash = tx.inputs[0].previousOutput.txHash;
  const txPrevious = await ForceBridgeCore.ckb.rpc.getTransaction(preHash);
  if (txPrevious == null) {
    return false;
  }
  const sudtType = txPrevious.transaction.outputs[Number(tx.inputs[0].previousOutput.index)].type;
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
  const recipientScript = tx.outputs[0].type;
  const expect = ForceBridgeCore.config.ckb.deps.recipientType.script;
  logger.debug('recipientScript:', recipientScript);
  logger.debug('expect:', expect);
  return recipientScript.codeHash == expect.codeHash;
}

type BurnDbData = {
  cellData: RecipientCellData;
  senderLockScriptHash: string;
};
