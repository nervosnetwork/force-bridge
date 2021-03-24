import { CkbDb } from '../db';
import { CkbBurn, EthUnlock, transformBurnEvent } from '../db/model';
import { logger } from '../utils/logger';
import { asyncSleep, blake2b } from '../utils';
import { Asset, ChainType, EthAsset, TronAsset } from '../ckb/model/asset';
import { Script as PwScript, Address, Transaction, Amount, AddressType } from '@lay2/pw-core';
import { Account } from '@force-bridge/ckb/model/accounts';

import { CkbTxGenerator } from '@force-bridge/ckb/tx-helper/generator';
import { IndexerCollector } from '@force-bridge/ckb/tx-helper/collector';
import { CkbIndexer } from '@force-bridge/ckb/tx-helper/indexer';
// import { Script } from '@ckb-lumos/base/lib/core';
import { Reader } from 'ckb-js-toolkit';
import { ForceBridgeCore } from '@force-bridge/core';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nconf = require('nconf');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs').promises;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const utils = require('@nervosnetwork/ckb-sdk-utils');

const PRI_KEY = process.env.PRI_KEY || '0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe';

// CKB handler
// 1. Listen CKB chain to get new burn events.
// 2. Listen database to get new mint events, send tx.
export class CkbHandler {
  private ckb = ForceBridgeCore.ckb;
  constructor(private db: CkbDb) {}

  // save unlock event first and then
  async saveBurnEvent(burn: CkbBurn): Promise<void> {
    logger.debug('save burn event');
    // const unlock = await transformBurnEvent(burn);
    // switch (unlock.name) {
    //   case 'EthUnlock': {
    //     await this.db.createEthUnlock([unlock]);
    //     break;
    //   }
    //   default: {
    //     throw new Error(`wrong unlock type: ${unlock.name}`);
    //   }
    // }
    // await this.db.saveCkbBurn([burn]);
  }

  async watchBurnEvents(): Promise<never> {
    // get cursor from db, usually the block height, to start the poll or subscribe
    // invoke saveBurnEvent when get new one
    while (true) {
      logger.debug('get new burn events and save to db');
      await asyncSleep(3000);
    }
  }

  async handleMintRecords(): Promise<never> {
    const account = new Account(PRI_KEY);
    logger.debug('ckb handle start: ', account.address);
    const generator = new CkbTxGenerator();
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
        switch (r.chain) {
          case ChainType.ETH:
            asset = new EthAsset(r.asset);
            break;
          case ChainType.TRON:
            asset = new TronAsset(r.asset);
            break;
          default:
            throw new Error('asset not supported!');
        }
        return {
          asset,
          amount: new Amount(r.amount),
          recipient: new Address(uint8ArrayToString(fromHexString(r.recipientLockscript)).slice(1), AddressType.ckb),
        };
      });
      const newTokens = records.filter((r) => !isBridgeCellExist(r.asset));
      if (newTokens.length > 0) {
        logger.debug('bridge cell is not exist. do create bridge cell.');
        const lockScriptBin = await fs.readFile('../ckb-contracts/build/release/bridge-lockscript');
        const lockScriptCodeHash = utils.bytesToHex(blake2b(lockScriptBin));
        const scripts = newTokens.map((r) => {
          return {
            codeHash: lockScriptCodeHash,
            hashType: 'data',
            args: r.asset.toBridgeLockscriptArgs(),
          };
        });
        const rawTx = await generator.createBridgeCell(await account.getLockscript(), scripts);
        const signedTx = this.ckb.signTransaction(PRI_KEY)(rawTx);
        const tx_hash = await this.ckb.rpc.sendTransaction(signedTx);
        await this.waitUntilCommitted(tx_hash);
        for (let i = 0; i < newTokens.length; i++) {
          const bridgeCellLockScriptHash = this.ckb.utils.scriptToHash(<CKBComponents.Script>scripts[i]);
          nconf.set(`'${newTokens[i].asset.toBridgeLockscriptArgs()}:bridgeCellLockscript'`, scripts[i]);
          nconf.set(
            `'${newTokens[i].asset.toBridgeLockscriptArgs()}:bridgeCellLockscriptHash'`,
            bridgeCellLockScriptHash,
          );
        }
        nconf.save();
        await sleep(5000);
      }

      // const account = new Account(PRI_KEY);
      // logger.debug('ckb handle start: ', account.address);
      // const generator = new CkbTxGenerator();
      const rawTx = await generator.mint(await account.getLockscript(), records);
      const signedTx = this.ckb.signTransaction(PRI_KEY)(rawTx);
      const mintTxHash = await this.ckb.rpc.sendTransaction(signedTx);
      console.log(`Mint Transaction has been sent with tx hash ${mintTxHash}`);
      await this.waitUntilCommitted(mintTxHash);
      await asyncSleep(3000);
      // send tx with this mint events, update db status when finish or throw error
    }
  }

  async waitUntilCommitted(txHash) {
    let waitTime = 0;
    while (true) {
      const txStatus = await this.ckb.rpc.getTransaction(txHash);
      console.log(`tx ${txHash} status: ${txStatus.txStatus.status}, index: ${waitTime}`);
      if (txStatus.txStatus.status === 'committed') {
        return txStatus;
      }
      await sleep(1000);
      waitTime += 1;
    }
  }

  start(): void {
    this.watchBurnEvents();
    this.handleMintRecords();
    logger.info('ckb handler started 🚀');
  }
}

const isBridgeCellExist = (asset) => nconf.get(`'${asset.toBridgeLockscriptArgs()}:bridgeCellLockscript'`) != undefined;

const fromHexString = (hexString) => new Uint8Array(hexString.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));

function uint8ArrayToString(data): string {
  let dataString = '';
  for (let i = 0; i < data.length; i++) {
    dataString += String.fromCharCode(data[i]);
  }
  return dataString;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
