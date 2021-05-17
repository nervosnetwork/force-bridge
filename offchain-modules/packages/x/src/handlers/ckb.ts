import { Script as LumosScript } from '@ckb-lumos/base';
import { Address, AddressType, Amount, HashType, Script } from '@lay2/pw-core';
import { Account } from '../ckb/model/accounts';
import { Asset, BtcAsset, ChainType, EosAsset, EthAsset, TronAsset } from '../ckb/model/asset';
import { IndexerCollector } from '../ckb/tx-helper/collector';
import { RecipientCellData } from '../ckb/tx-helper/generated/eth_recipient_cell';
import { CkbTxGenerator, MintAssetRecord } from '../ckb/tx-helper/generator';
import { ScriptType } from '../ckb/tx-helper/indexer';
import { ForceBridgeCore } from '../core';
import { CkbDb } from '../db';
import { CkbMint, ICkbBurn } from '../db/model';
import { asyncSleep, fromHexString, toHexString, uint8ArrayToString } from '../utils';
import { logger } from '../utils/logger';
import { getAssetTypeByAsset } from '../xchain/tron/utils';
import Transaction = CKBComponents.Transaction;
import TransactionWithStatus = CKBComponents.TransactionWithStatus;

// CKB handler
// 1. Listen CKB chain to get new burn events.
// 2. Listen database to get new mint events, send tx.
export class CkbHandler {
  private ckb = ForceBridgeCore.ckb;
  private indexer = ForceBridgeCore.indexer;
  private PRI_KEY = ForceBridgeCore.config.ckb.privateKey;
  constructor(private db: CkbDb) {}

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
        if (await this.isBurnTx(tx, cellData)) {
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
    const committeeLockHash = await this.getOwnLockHash();
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

  async isBurnTx(tx: Transaction, cellData: RecipientCellData): Promise<boolean> {
    if (tx.outputs.length < 1) {
      return false;
    }
    const ownLockHash = await this.getOwnLockHash();
    logger.debug('CkbHandler isBurnTx amount: ', toHexString(new Uint8Array(cellData.getAmount().raw())));
    logger.debug(
      'CkbHandler isBurnTx recipient address: ',
      toHexString(new Uint8Array(cellData.getRecipientAddress().raw())),
    );
    logger.debug('CkbHandler isBurnTx asset: ', toHexString(new Uint8Array(cellData.getAsset().raw())));
    logger.debug('CkbHandler isBurnTx chain: ', cellData.getChain());
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
    const txPrevious = await this.ckb.rpc.getTransaction(preHash);
    if (txPrevious == null) {
      return false;
    }
    const sudtType = txPrevious.transaction.outputs[Number(tx.inputs[0].previousOutput.index)].type;
    const expectType = {
      codeHash: ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash,
      hashType: ForceBridgeCore.config.ckb.deps.sudtType.script.hashType,
      args: this.getBridgeLockHash(asset),
    };
    logger.debug('CkbHandler isBurnTx expectType:', expectType);
    logger.debug('CkbHandler isBurnTx sudtType:', sudtType);
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

  async handleMintRecords(): Promise<never> {
    const account = new Account(this.PRI_KEY);
    const ownLockHash = await this.getOwnLockHash();
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
        await this.createBridgeCell(newTokens, generator);
      }

      try {
        mintRecords.map((r) => {
          r.status = 'pending';
        });
        await this.db.updateCkbMint(mintRecords);
        const rawTx = await generator.mint(await account.getLockscript(), records);
        const signedTx = this.ckb.signTransaction(this.PRI_KEY)(rawTx);
        const mintTxHash = await this.ckb.rpc.sendTransaction(signedTx);
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
      await this.indexer.waitUntilSync();
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
      const bridgeCells = await this.indexer.getCells(searchKey);
      if (bridgeCells.length == 0) {
        newTokens.push(record);
      }
    }
    return newTokens;
  }

  async createBridgeCell(newTokens: MintAssetRecord[], generator: CkbTxGenerator) {
    const account = new Account(this.PRI_KEY);
    const scripts = newTokens.map((r) => {
      return {
        codeHash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
        hashType: HashType.data,
        args: r.asset.toBridgeLockscriptArgs(),
      };
    });
    const rawTx = await generator.createBridgeCell(await account.getLockscript(), scripts);
    const signedTx = this.ckb.signTransaction(this.PRI_KEY)(rawTx);
    const tx_hash = await this.ckb.rpc.sendTransaction(signedTx);
    await this.waitUntilCommitted(tx_hash, 60);
    await this.indexer.waitUntilSync();
  }

  async getOwnLockHash(): Promise<string> {
    const account = new Account(this.PRI_KEY);
    const ownLockHash = this.ckb.utils.scriptToHash(<CKBComponents.Script>await account.getLockscript());
    return ownLockHash;
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
    this.watchBurnEvents();
    this.handleMintRecords();
    logger.info('ckb handler started 🚀');
  }
}

type BurnDbData = {
  cellData: RecipientCellData;
  senderLockScriptHash: string;
};
