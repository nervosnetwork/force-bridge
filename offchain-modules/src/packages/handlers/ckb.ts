import { CkbDb } from '../db';
import { CkbBurn, EthUnlock, ICkbBurn, transformBurnEvent } from '../db/model';
import { logger } from '../utils/logger';
import { asyncSleep, blake2b, fromHexString, toHexString, uint8ArrayToString } from '../utils';
import { Asset, ChainType, EosAsset, EthAsset, TronAsset } from '../ckb/model/asset';
import { Script as PwScript, Address, Amount, AddressType, Script, HashType } from '@lay2/pw-core';
import { Account } from '@force-bridge/ckb/model/accounts';

import { CkbTxGenerator } from '@force-bridge/ckb/tx-helper/generator';
import { IndexerCollector } from '@force-bridge/ckb/tx-helper/collector';
import { ScriptType } from '@force-bridge/ckb/tx-helper/indexer';
import { ForceBridgeCore } from '@force-bridge/core';
import Transaction = CKBComponents.Transaction;
import { Script as LumosScript } from '@ckb-lumos/base';
import { BigNumber } from 'ethers';
import { RecipientCellData } from '@force-bridge/ckb/tx-helper/eth_recipient_cell';

const fs = require('fs').promises;

const utils = require('@nervosnetwork/ckb-sdk-utils');

const PRI_KEY = '0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe';

// CKB handler
// 1. Listen CKB chain to get new burn events.
// 2. Listen database to get new mint events, send tx.
export class CkbHandler {
  private ckb = ForceBridgeCore.ckb;
  private indexer = ForceBridgeCore.indexer;
  constructor(private db: CkbDb) {}

  // save unlock event first and then
  async saveBurnEvent(burns: ICkbBurn[]): Promise<void> {
    logger.debug('save burn event:', burns);
    for (const burn of burns) {
      switch (burn.chain) {
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
              assetType: burn.asset,
              amount: burn.amount,
              recipientAddress: burn.recipientAddress,
            },
          ]);
          break;
        case ChainType.EOS:
          await this.db.createEosUnlock([
            {
              ckbTxHash: burn.ckbTxHash,
              asset: uint8ArrayToString(fromHexString(burn.asset)),
              amount: burn.amount,
              recipientAddress: uint8ArrayToString(fromHexString(burn.recipientAddress)),
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
          let amount;
          if (chain == ChainType.EOS) {
            amount = Amount.fromUInt128LE(`0x${toHexString(new Uint8Array(v.getAmount().raw()))}`).toString();
          } else {
            amount = BigNumber.from(
              Amount.fromUInt128LE(`0x${toHexString(new Uint8Array(v.getAmount().raw()))}`),
            ).toHexString();
          }
          ckbBurns.push({
            ckbTxHash: k,
            asset: `0x${toHexString(new Uint8Array(v.getAsset().raw()))}`,
            chain,
            amount,
            recipientAddress: `0x${toHexString(new Uint8Array(v.getRecipientAddress().raw()))}`,
            blockNumber: latestHeight,
          });
        });
        await this.saveBurnEvent(ckbBurns);
      }
      latestHeight++;
      await asyncSleep(1000);
    }
  }

  async isBurnTx(tx: Transaction, cellData: RecipientCellData) {
    const account = new Account(PRI_KEY);
    const ownLockHash = this.ckb.utils.scriptToHash(<CKBComponents.Script>await account.getLockscript());
    if (tx.outputs.length < 1) {
      return false;
    }
    logger.debug('amount: ', toHexString(new Uint8Array(cellData.getAmount().raw())));
    logger.debug('recipient address: ', toHexString(new Uint8Array(cellData.getRecipientAddress().raw())));
    logger.debug('asset: ', toHexString(new Uint8Array(cellData.getAsset().raw())));
    logger.debug('chain: ', cellData.getChain());
    logger.debug('bridge lock code hash: ', toHexString(new Uint8Array(cellData.getBridgeLockCodeHash().raw())));
    let asset;
    const assetAddress = toHexString(new Uint8Array(cellData.getAsset().raw()));
    switch (cellData.getChain()) {
      case ChainType.ETH:
        asset = new EthAsset(`0x${assetAddress}`, ownLockHash);
        break;
      case ChainType.TRON:
        asset = new TronAsset(uint8ArrayToString(fromHexString(assetAddress)), ownLockHash);
        logger.debug('tron asset: ', asset);
        break;
      case ChainType.EOS:
        asset = new EosAsset(uint8ArrayToString(fromHexString(assetAddress)), ownLockHash);
        logger.debug('eos asset: ', asset);
        break;
      default:
        return false;
    }
    const bridgeCellLockscript = {
      codeHash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
      hashType: ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
      args: asset.toBridgeLockscriptArgs(),
    };
    const sudtArgs = this.ckb.utils.scriptToHash(<CKBComponents.Script>bridgeCellLockscript);

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
      args: sudtArgs,
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
    const account = new Account(PRI_KEY);
    const ownLockHash = this.ckb.utils.scriptToHash(<CKBComponents.Script>await account.getLockscript());
    logger.debug('ckb handle start: ', account.address);
    const generator = new CkbTxGenerator(this.ckb, new IndexerCollector(this.indexer));
    while (true) {
      const mintRecords = await this.db.getCkbMintRecordsToMint();
      logger.debug('new mintRecords: ', mintRecords);
      if (mintRecords.length == 0) {
        logger.debug('wait for new mint records');
        await asyncSleep(3000);
        continue;
      }
      const records = mintRecords.map((r) => {
        let asset;
        let recipient;
        let amount;
        switch (r.chain) {
          case ChainType.ETH:
            asset = new EthAsset(r.asset, ownLockHash);
            recipient = new Address(uint8ArrayToString(fromHexString(r.recipientLockscript)), AddressType.ckb);
            amount = Amount.fromUInt128LE(r.amount);
            break;
          case ChainType.TRON:
            asset = new TronAsset(r.asset, ownLockHash);
            recipient = new Address(r.recipientLockscript, AddressType.ckb);
            amount = new Amount(r.amount);
            break;
          case ChainType.EOS:
            asset = new EosAsset(r.asset, ownLockHash);
            recipient = new Address(r.recipientLockscript, AddressType.ckb);
            amount = new Amount(r.amount);
            break;
          default:
            throw new Error('asset not supported!');
        }
        return {
          asset,
          amount,
          recipient,
        };
      });
      const newTokens = [];
      for (const record of records) {
        logger.debug('record:', record);
        const bridgeCellLockscript = {
          codeHash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
          hashType: ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
          args: record.asset.toBridgeLockscriptArgs(),
        };
        logger.debug('record: bridgeCellLockscript ', bridgeCellLockscript);
        // const args = this.ckb.utils.scriptToHash(<CKBComponents.Script>bridgeCellLockscript);
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

      if (newTokens.length > 0) {
        logger.debug('bridge cell is not exist. do create bridge cell.');
        const lockScriptBin = await fs.readFile('../ckb-contracts/build/release/bridge-lockscript');
        const lockScriptCodeHash = utils.bytesToHex(blake2b(lockScriptBin));
        const scripts = newTokens.map((r) => {
          return {
            codeHash: lockScriptCodeHash,
            hashType: HashType.data,
            args: r.asset.toBridgeLockscriptArgs(),
          };
        });
        const rawTx = await generator.createBridgeCell(await account.getLockscript(), scripts);
        const signedTx = this.ckb.signTransaction(PRI_KEY)(rawTx);
        const tx_hash = await this.ckb.rpc.sendTransaction(signedTx);
        await this.waitUntilCommitted(tx_hash, 60);
        await asyncSleep(10000);
      }

      try {
        mintRecords.map((r) => {
          r.status = 'pending';
        });
        await this.db.updateCkbMint(mintRecords);
        const rawTx = await generator.mint(await account.getLockscript(), records);
        const signedTx = this.ckb.signTransaction(PRI_KEY)(rawTx);
        const mintTxHash = await this.ckb.rpc.sendTransaction(signedTx);
        console.log(`Mint Transaction has been sent with tx hash ${mintTxHash}`);
        const txStatus = await this.waitUntilCommitted(mintTxHash, 60);
        await asyncSleep(10000);
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

      await asyncSleep(60000);
    }
  }

  async waitUntilCommitted(txHash, timeout) {
    let waitTime = 0;
    while (true) {
      const txStatus = await this.ckb.rpc.getTransaction(txHash);
      console.log(`tx ${txHash} status: ${txStatus.txStatus.status}, index: ${waitTime}`);
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
