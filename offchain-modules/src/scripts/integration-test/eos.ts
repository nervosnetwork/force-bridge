import { createConnection } from 'typeorm';
import 'module-alias/register';
import nconf from 'nconf';
import { Config, EosConfig } from '@force-bridge/config';
import { logger } from '@force-bridge/utils/logger';
import { JsSignatureProvider } from 'eosjs/dist/eosjs-jssig';
import { CkbDb } from '@force-bridge/db';
import { EosLock, getEosLockId } from '@force-bridge/db/entity/EosLock';
import { asyncSleep, bigintToSudtAmount, genRandomHex, waitUntilCommitted } from '@force-bridge/utils';
import assert from 'assert';
import { CkbMint } from '@force-bridge/db/entity/CkbMint';
import { ChainType, EosAsset, TronAsset } from '@force-bridge/ckb/model/asset';
import { EosUnlock } from '@force-bridge/db/entity/EosUnlock';
import { EosChain } from '@force-bridge/xchain/eos/eosChain';
import { Account } from '@force-bridge/ckb/model/accounts';
import { CkbTxGenerator } from '@force-bridge/ckb/tx-helper/generator';
import { IndexerCollector } from '@force-bridge/ckb/tx-helper/collector';
import { Amount, Script } from '@lay2/pw-core';

import { CkbIndexer } from '@force-bridge/ckb/tx-helper/indexer';
import { ForceBridgeCore } from '@force-bridge/core';

// const PRI_KEY = process.env.PRI_KEY || '0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe';
const CKB = require('@nervosnetwork/ckb-sdk-core').default;
// const { Indexer, CellCollector } = require('@ckb-lumos/indexer');
const CKB_URL = process.env.CKB_URL || 'http://127.0.0.1:8114';
// const LUMOS_DB = './lumos_db';
const indexer = new CkbIndexer('http://127.0.0.1:8116');
const collector = new IndexerCollector(indexer);
// indexer.startForever();
const ckb = new CKB(CKB_URL);

type waitFn = () => Promise<boolean>;

async function waitFnCompleted(timeout: number, fn: waitFn, sleepTime = 1000) {
  const start = new Date().getTime();
  while (true) {
    if (await fn()) {
      return;
    }
    if (new Date().getTime() - start >= timeout) {
      throw new Error(`waitFnCompleted timeout after:${timeout}`);
    }
    await asyncSleep(sleepTime);
  }
}

async function main() {
  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const config: EosConfig = nconf.get('forceBridge:eos');
  logger.debug('EosConfig:', config);
  const conf: Config = nconf.get('forceBridge');
  // init bridge force core
  await new ForceBridgeCore().init(conf);

  const rpcUrl = config.rpcUrl;
  const PRI_KEY = ForceBridgeCore.config.ckb.privateKey;
  const lockAccount = 'spongebob111';
  const lockAccountPri = ['5KQ1LgoXrSLiUMS8HZp6rSuyyJP5i6jTi1KWbZNerQQLFeTrxac'];
  const chain = new EosChain(rpcUrl, new JsSignatureProvider(lockAccountPri));
  const conn = await createConnection();
  const ckbDb = new CkbDb(conn);

  //lock eos
  const recipientLockscript = 'ckt1qyqyph8v9mclls35p6snlaxajeca97tc062sa5gahk';
  const memo = recipientLockscript;
  const lockAmount = '0.0001';
  const lockAsset = 'EOS';
  const eosTokenAccount = 'eosio.token';

  const lockTxRes = await chain.transfer(
    lockAccount,
    config.bridgerAccount,
    'active',
    `${lockAmount} ${lockAsset}`,
    memo,
    eosTokenAccount,
    {
      broadcast: true,
      blocksBehind: 3,
      expireSeconds: 30,
    },
  );

  let lockTxHash: string;
  if ('transaction_id' in lockTxRes) {
    lockTxHash = lockTxRes.transaction_id;
    logger.debug('EosLockTx:', lockTxRes);
  } else {
    throw new Error('send lock eos transaction failed. txRes:' + lockTxRes);
  }
  const transferActionId = getEosLockId(lockTxHash, 1);

  //check EosLock and EosMint saved.
  const waitTimeout = 1000 * 60 * 5; //5 minutes
  await waitFnCompleted(
    waitTimeout,
    async (): Promise<boolean> => {
      const eosLockRecords = await conn.manager.find(EosLock, {
        where: {
          id: transferActionId,
        },
      });
      const ckbMintRecords = await conn.manager.find(CkbMint, {
        where: {
          id: transferActionId,
        },
      });
      if (eosLockRecords.length == 0 || ckbMintRecords.length === 0) {
        return false;
      }

      logger.debug('EosLockRecords', eosLockRecords);
      logger.debug('CkbMintRecords', ckbMintRecords);

      assert(eosLockRecords.length === 1);
      const eosLockRecord = eosLockRecords[0];
      assert(eosLockRecord.amount === lockAmount);
      assert(eosLockRecord.token === lockAsset);
      assert(eosLockRecord.memo === memo);
      assert(eosLockRecord.sender === lockAccount);

      assert(ckbMintRecords.length === 1);
      const ckbMintRecord = ckbMintRecords[0];
      assert(ckbMintRecord.chain === ChainType.EOS);
      assert(ckbMintRecord.asset === lockAsset);
      assert(ckbMintRecord.amount === lockAmount);
      assert(ckbMintRecord.recipientLockscript === recipientLockscript);
      return ckbMintRecord.status === 'success';
    },
    1000 * 10,
  );

  // check sudt balance.
  const account = new Account(PRI_KEY);
  const ownLockHash = ckb.utils.scriptToHash(<CKBComponents.Script>await account.getLockscript());
  const asset = new EosAsset(lockAsset, ownLockHash);
  const bridgeCellLockscript = {
    codeHash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
    hashType: ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
    args: asset.toBridgeLockscriptArgs(),
  };
  const sudtArgs = ckb.utils.scriptToHash(<CKBComponents.Script>bridgeCellLockscript);
  const sudtType = {
    codeHash: ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash,
    hashType: ForceBridgeCore.config.ckb.deps.sudtType.script.hashType,
    args: sudtArgs,
  };
  await waitFnCompleted(
    waitTimeout,
    async (): Promise<boolean> => {
      const balance = await collector.getSUDTBalance(
        new Script(sudtType.codeHash, sudtType.args, sudtType.hashType),
        await account.getLockscript(),
      );

      logger.debug('sudt balance:', balance.toHexString());
      logger.debug('expect balance:', new Amount(lockAmount).toUInt128LE());
      return balance.eq(new Amount(lockAmount));
    },
    1000 * 10,
  );

  //unlock eos
  // const unlockRecord = {
  //   ckbTxHash: genRandomHex(32),
  //   asset: lockAsset,
  //   amount: lockAmount,
  //   recipientAddress: lockAccount,
  // };
  // await ckbDb.createEosUnlock([unlockRecord]);
  // send burn tx
  const burnAmount = Amount.fromUInt128LE('0x10270000000000000000000000000000');
  // const account = new Account(PRI_KEY);
  // const ownLockHash = ckb.utils.scriptToHash(<CKBComponents.Script>await account.getLockscript());
  const generator = new CkbTxGenerator(ckb, new IndexerCollector(indexer));
  const burnTx = await generator.burn(
    await account.getLockscript(),
    lockAccount,
    new EosAsset(lockAsset, ownLockHash),
    burnAmount,
  );
  const signedTx = ckb.signTransaction(PRI_KEY)(burnTx);
  const burnTxHash = await ckb.rpc.sendTransaction(signedTx);
  console.log(`burn Transaction has been sent with tx hash ${burnTxHash}`);
  await waitUntilCommitted(ckb, burnTxHash, 60);

  await waitFnCompleted(
    waitTimeout,
    async (): Promise<boolean> => {
      const balance = await collector.getSUDTBalance(
        new Script(sudtType.codeHash, sudtType.args, sudtType.hashType),
        await account.getLockscript(),
      );

      logger.debug('sudt balance:', balance.toHexString());
      logger.debug('expect balance:', new Amount(lockAmount).sub(burnAmount).toHexString());
      return balance.eq(new Amount(lockAmount).sub(burnAmount));
    },
    1000 * 10,
  );

  //check unlock record send
  let eosUnlockTxHash = '';
  await waitFnCompleted(
    waitTimeout,
    async () => {
      const eosUnlockRecords = await conn.manager.find(EosUnlock, {
        where: {
          ckbTxHash: burnTxHash,
          status: 'success',
        },
      });
      if (eosUnlockRecords.length === 0) {
        return false;
      }
      logger.debug('EosUnlockRecords', eosUnlockRecords);
      assert(eosUnlockRecords.length === 1);
      const eosUnlockRecord = eosUnlockRecords[0];
      assert(eosUnlockRecord.recipientAddress == lockAccount);
      assert(eosUnlockRecord.asset === lockAsset);
      logger.debug('amount: ', eosUnlockRecord.amount);
      logger.debug('amount: ', burnAmount.toString());
      assert(eosUnlockRecord.amount === burnAmount.toString());
      eosUnlockTxHash = eosUnlockRecord.eosTxHash;
      return true;
    },
    1000 * 10,
  );

  // if (eosUnlockTxHash !== '') {
  //   const eosUnlockTx = await chain.getTransaction(eosUnlockTxHash);
  //   logger.debug('EosUnlockTx status:', eosUnlockTx.trx.receipt.status);
  // }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
