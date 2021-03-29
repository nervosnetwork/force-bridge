import { CkbDb } from '../db';
import { CkbBurn, EthUnlock, ICkbBurn, transformBurnEvent } from '../db/model';
import { logger } from '../utils/logger';
import { asyncSleep, blake2b, fromHexString, uint8ArrayToString } from '../utils';
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
              asset: uint8ArrayToString(fromHexString(burn.asset)).slice(1),
              amount: burn.amount,
              recipientAddress: uint8ArrayToString(fromHexString(burn.recipientAddress)).slice(1),
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
      const burnTxs = [];
      for (const tx of block.transactions) {
        if (await this.isBurnTx(tx)) {
          burnTxs.push(tx);
        }
      }
      logger.debug('get new burn events and save to db', burnTxs);
      if (burnTxs.length > 0) {
        const ckbBurns = burnTxs.map((tx) => {
          const recipientData = tx.outputsData[0].toString();
          logger.debug(`amount: 0x${recipientData.slice(84, 116)}`);
          logger.debug('amount: ', Amount.fromUInt128LE(`0x${recipientData.slice(84, 116)}`).toHexString());
          const chain = Number(recipientData.slice(2, 4));
          switch (chain) {
            case ChainType.ETH:
              return {
                ckbTxHash: tx.hash,
                asset: `0x${recipientData.slice(44, 84)}`,
                chain,
                amount: BigNumber.from(Amount.fromUInt128LE(`0x${recipientData.slice(84, 116)}`)).toHexString(),
                recipientAddress: `0x${recipientData.slice(4, 44)}`,
                blockNumber: latestHeight,
              };
            case ChainType.TRON:
              return {
                ckbTxHash: tx.hash,
                asset: `0x${recipientData.slice(72, 78)}`,
                chain,
                amount: BigNumber.from(Amount.fromUInt128LE(`0x${recipientData.slice(78, 110)}`)).toHexString(),
                recipientAddress: `0x${recipientData.slice(4, 72)}`,
                blockNumber: latestHeight,
              };
            case ChainType.EOS:
              return {
                ckbTxHash: tx.hash,
                asset: `0x${recipientData.slice(28, 34)}`,
                chain,
                amount: Amount.fromUInt128LE(`0x${recipientData.slice(34, 66)}`).toString(),
                recipientAddress: `0x${recipientData.slice(4, 28)}`,
                blockNumber: latestHeight,
              };
            default:
              throw new Error(`wrong burn chain type: ${chain}`);
          }
        });
        await this.saveBurnEvent(ckbBurns);
      }
      latestHeight++;
      await asyncSleep(1000);
    }
  }

  async isBurnTx(tx: Transaction) {
    if (tx.outputs.length < 1) {
      return false;
    }
    const recipientData = tx.outputsData[0].toString();
    logger.debug('recipientData:', recipientData);
    // if (recipientData.length != 2 + 2 + 40 + 40 + 32 + 64 + 64) {
    //   return false;
    // }
    let asset;
    let assetAddress;
    const chain = Number(recipientData.slice(2, 4));
    switch (chain) {
      case ChainType.ETH:
        if (recipientData.length != 2 + 2 + 40 + 40 + 32 + 64 + 64) {
          return false;
        }
        assetAddress = recipientData.slice(44, 84);
        asset = new EthAsset(`0x${assetAddress}`);
        break;
      case ChainType.TRON:
        if (recipientData.length != 2 + 2 + 68 + 6 + 32 + 64 + 64) {
          return false;
        }
        assetAddress = recipientData.slice(72, 78);
        asset = new TronAsset(uint8ArrayToString(fromHexString(assetAddress)));
        logger.debug('tron asset: ', asset);
        break;
      case ChainType.EOS:
        if (recipientData.length != 2 + 2 + 24 + 6 + 32 + 64 + 64) {
          return false;
        }
        assetAddress = recipientData.slice(28, 34);
        asset = new EosAsset(uint8ArrayToString(fromHexString(assetAddress)));
        logger.debug('tron asset: ', asset);
        break;
      default:
        return false;
      // throw new Error(`wrong burn chain type: ${chain}`);
    }
    // const asset = new EthAsset(recipient.asset);
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
      hashType: ForceBridgeCore.config.ckb.deps.sudtType.script.args,
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
    // const expect = {
    //   codeHash: nconf.get('forceBridge:ckb:deps:recipientType:script:codeHash'),
    //   hashType: nconf.get('forceBridge:ckb:deps:recipientType:script:hashType'),
    //   args: '0x',
    // };
    logger.debug('recipientScript:', recipientScript);
    logger.debug('expect:', expect);
    return recipientScript.codeHash == expect.codeHash && recipientScript.args == expect.args;
  }

  async handleMintRecords(): Promise<never> {
    const account = new Account(PRI_KEY);
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
        switch (r.chain) {
          case ChainType.ETH:
            asset = new EthAsset(r.asset);
            recipient = new Address(uint8ArrayToString(fromHexString(r.recipientLockscript)).slice(1), AddressType.ckb);
            break;
          case ChainType.TRON:
            asset = new TronAsset(r.asset);
            recipient = new Address(r.recipientLockscript, AddressType.ckb);
            break;
          case ChainType.EOS:
            asset = new EosAsset(r.asset);
            recipient = new Address(r.recipientLockscript, AddressType.ckb);
            break;
          default:
            throw new Error('asset not supported!');
        }
        return {
          asset,
          amount: new Amount(r.amount),
          recipient,
        };
      });
      const newTokens = [];
      for (const record of records) {
        logger.debug('record:', record);
        const bridgeCellLockscript = {
          codeHash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
          hashType: ForceBridgeCore.config.ckb.deps.bridgeLock.script.args,
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
