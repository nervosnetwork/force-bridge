import { CkbDb } from '../db';
import { CkbMint, ICkbBurn } from '../db/model';
import { logger } from '../utils/logger';
import { asyncSleep, fromHexString, toHexString, uint8ArrayToString, bigintToSudtAmount } from '../utils';
import { Asset, BtcAsset, ChainType, EosAsset, EthAsset, TronAsset } from '../ckb/model/asset';
import { Address, Amount, AddressType, Script, HashType } from '@lay2/pw-core';
import { Account } from '@force-bridge/ckb/model/accounts';

import { CkbTxGenerator } from '@force-bridge/ckb/tx-helper/generator';
import { IndexerCollector } from '@force-bridge/ckb/tx-helper/collector';
import { ScriptType } from '@force-bridge/ckb/tx-helper/indexer';
import { ForceBridgeCore } from '@force-bridge/core';
import Transaction = CKBComponents.Transaction;
import { Script as LumosScript } from '@ckb-lumos/base';
import { BigNumber } from 'ethers';
import { RecipientCellData } from '@force-bridge/ckb/tx-helper/generated/eth_recipient_cell';
import { getAssetTypeByAsset } from '@force-bridge/xchain/tron/utils';

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
    logger.debug('save burn event:', burns);
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
      logger.debug('watch burn event height: ', latestHeight);
      const block = await this.ckb.rpc.getBlockByNumber(BigInt(latestHeight));
      if (block == null) {
        logger.debug('waitting for new ckb block');
        await asyncSleep(5000);
        continue;
      }
      const burnTxs = new Map();
      for (const tx of block.transactions) {
        const recipientData = tx.outputsData[0];
        logger.debug('recipientData:', recipientData);
        let cellData;
        try {
          cellData = new RecipientCellData(fromHexString(recipientData).buffer);
        } catch (e) {
          continue;
        }
        if (await this.isBurnTx(tx, cellData)) {
          burnTxs.set(tx.hash, cellData);
        }
      }
      logger.debug('get new burn events and save to db', burnTxs);
      if (burnTxs.size > 0) {
        const ckbBurns = [];
        burnTxs.forEach((v: RecipientCellData, k: string) => {
          const chain = v.getChain();
          let burn;
          switch (chain) {
            case ChainType.BTC:
              burn = {
                ckbTxHash: k,
                asset: uint8ArrayToString(new Uint8Array(v.getAsset().raw())),
                chain,
                amount: Amount.fromUInt128LE(`0x${toHexString(new Uint8Array(v.getAmount().raw()))}`).toString(),
                recipientAddress: uint8ArrayToString(new Uint8Array(v.getRecipientAddress().raw())),
                blockNumber: latestHeight,
              };
              break;
            case ChainType.ETH:
              burn = {
                ckbTxHash: k,
                asset: `0x${toHexString(new Uint8Array(v.getAsset().raw()))}`,
                chain,
                amount: Amount.fromUInt128LE(`0x${toHexString(new Uint8Array(v.getAmount().raw()))}`).toString(),
                recipientAddress: `0x${toHexString(new Uint8Array(v.getRecipientAddress().raw()))}`,
                blockNumber: latestHeight,
              };
              break;
            case ChainType.TRON:
              burn = {
                ckbTxHash: k,
                asset: uint8ArrayToString(new Uint8Array(v.getAsset().raw())),
                chain,
                amount: Amount.fromUInt128LE(`0x${toHexString(new Uint8Array(v.getAmount().raw()))}`).toString(),
                recipientAddress: uint8ArrayToString(new Uint8Array(v.getRecipientAddress().raw())),
                blockNumber: latestHeight,
              };
              break;
            case ChainType.EOS:
              burn = {
                ckbTxHash: k,
                asset: uint8ArrayToString(new Uint8Array(v.getAsset().raw())),
                chain,
                amount: Amount.fromUInt128LE(`0x${toHexString(new Uint8Array(v.getAmount().raw()))}`).toString(),
                recipientAddress: uint8ArrayToString(new Uint8Array(v.getRecipientAddress().raw())),
                blockNumber: latestHeight,
              };
              break;
          }
          ckbBurns.push(burn);
        });
        await this.saveBurnEvent(ckbBurns);
      }
      latestHeight++;
      await asyncSleep(1000);
    }
  }

  async isBurnTx(tx: Transaction, cellData: RecipientCellData): Promise<boolean> {
    if (tx.outputs.length < 1) {
      return false;
    }
    const ownLockHash = await this.getOwnLockHash();
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
        asset = new EthAsset(`0x${assetAddress}`, ownLockHash);
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

  async handleMintRecords(): Promise<never> {
    const account = new Account(this.PRI_KEY);
    const ownLockHash = await this.getOwnLockHash();
    const generator = new CkbTxGenerator(this.ckb, new IndexerCollector(this.indexer));
    while (true) {
      const mintRecords = await this.db.getCkbMintRecordsToMint();
      logger.debug('new mintRecords: ', mintRecords);
      if (mintRecords.length == 0) {
        logger.debug('wait for new mint records');
        await asyncSleep(3000);
        continue;
      }
      const records = mintRecords.map((r) => this.filterMintRecords(r, ownLockHash));
      const newTokens = await this.filterNewTokens(records);

      if (newTokens.length > 0) {
        logger.debug('bridge cell is not exist. do create bridge cell.');
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
        console.log(`Mint Transaction has been sent with tx hash ${mintTxHash}`);
        const txStatus = await this.waitUntilCommitted(mintTxHash, 60);
        if (txStatus.txStatus.status === 'committed') {
          mintRecords.map((r) => {
            r.status = 'success';
          });
        } else {
          mintRecords.map((r) => {
            r.status = 'error';
          });
          logger.error('mint execute failed: ', mintRecords);
        }
        await this.db.updateCkbMint(mintRecords);
      } catch (e) {
        logger.debug('mint execute failed:', e.toString());
        mintRecords.map((r) => {
          r.status = 'error';
        });
        await this.db.updateCkbMint(mintRecords);
      }
      await this.indexer.waitUntilSync();
    }
  }

  filterMintRecords(r: CkbMint, ownLockHash: string): any {
    switch (r.chain) {
      case ChainType.BTC:
        return {
          asset: new BtcAsset(r.asset, ownLockHash),
          recipient: new Address(r.recipientLockscript, AddressType.ckb),
          amount: new Amount(r.amount),
        };
      case ChainType.ETH:
        return {
          asset: new EthAsset(r.asset, ownLockHash),
          recipient: new Address(uint8ArrayToString(fromHexString(r.recipientLockscript)), AddressType.ckb),
          amount: new Amount(BigNumber.from(r.amount).toString()),
        };
      case ChainType.TRON:
        return {
          asset: new TronAsset(r.asset, ownLockHash),
          amount: new Amount(r.amount),
          recipient: new Address(r.recipientLockscript, AddressType.ckb),
        };
      case ChainType.EOS:
        return {
          asset: new EosAsset(r.asset, ownLockHash),
          amount: new Amount(r.amount),
          recipient: new Address(r.recipientLockscript, AddressType.ckb),
        };
      default:
        throw new Error('asset not supported!');
    }
  }

  async filterNewTokens(records: any[]): Promise<any[]> {
    const newTokens = [];
    for (const record of records) {
      logger.debug('record:', record);
      const bridgeCellLockscript = {
        codeHash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
        hashType: ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
        args: record.asset.toBridgeLockscriptArgs(),
      };
      logger.debug('record: bridgeCellLockscript ', bridgeCellLockscript);
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

  async createBridgeCell(newTokens: any[], generator: CkbTxGenerator) {
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
    while (true) {
      const txStatus = await this.ckb.rpc.getTransaction(txHash);
      logger.debug(`tx ${txHash} status: ${txStatus.txStatus.status}, index: ${waitTime}`);
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
