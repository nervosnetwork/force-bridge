import assert from 'assert';
import { Account } from '@force-bridge/x/dist/ckb/model/accounts';
import { BtcAsset, ChainType } from '@force-bridge/x/dist/ckb/model/asset';
import { IndexerCollector } from '@force-bridge/x/dist/ckb/tx-helper/collector';
import { CkbTxGenerator } from '@force-bridge/x/dist/ckb/tx-helper/generator';
import { CkbIndexer } from '@force-bridge/x/dist/ckb/tx-helper/indexer';
import { Config } from '@force-bridge/x/dist/config';
import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { BtcDb } from '@force-bridge/x/dist/db/btc';
import { BtcLock } from '@force-bridge/x/dist/db/entity/BtcLock';
import { BtcUnlock } from '@force-bridge/x/dist/db/entity/BtcUnlock';
import { CkbMint } from '@force-bridge/x/dist/db/entity/CkbMint';
import { asyncSleep } from '@force-bridge/x/dist/utils';
import { logger, initLog } from '@force-bridge/x/dist/utils/logger';
import { BTCChain, getBtcMainnetFee } from '@force-bridge/x/dist/xchain/btc';

import { Amount, Script } from '@lay2/pw-core';
import CKB from '@nervosnetwork/ckb-sdk-core';
import bitcore from 'bitcore-lib';
import nconf from 'nconf';
import { RPCClient } from 'rpc-bitcoin';
import { createConnection } from 'typeorm';
import { waitFnCompleted, waitUntilCommitted } from './util';
// const CKB = require('@nervosnetwork/ckb-sdk-core').default;

const CKB_URL = process.env.CKB_URL || 'http://127.0.0.1:8114';
const CKB_INDEXER_URL = process.env.CKB_INDEXER_URL || 'http://127.0.0.1:8116';
const indexer = new CkbIndexer(CKB_URL, CKB_INDEXER_URL);
const collector = new IndexerCollector(indexer);
const ckb = new CKB(CKB_URL);

async function main() {
  logger.debug('start btc test lock and unlock');

  const conn = await createConnection();
  const btcDb = new BtcDb(conn);

  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const config: Config = nconf.get('forceBridge');
  config.common.log.logFile = './log/btc-ci.log';
  initLog(config.common.log);

  // init bridge force core
  await new ForceBridgeCore().init(config);

  logger.debug(`config: ${config}`);
  const PRI_KEY = ForceBridgeCore.config.ckb.privateKey;
  const client = new RPCClient(config.btc.clientParams);
  const btcChain = new BTCChain();

  const privKeys2 = config.btc.privateKeys.map((pk) => new bitcore.PrivateKey(pk.slice(2)));
  const pubKeys2 = privKeys2.map((pk) => pk.toPublicKey());
  const MultiSigAddress2 = bitcore.Address.createMultisig(pubKeys2, 2, 'testnet');
  logger.debug(`multi sign address: ${MultiSigAddress2.toString()}`);

  // transfer to multisigAddr
  const userPrivKey = new bitcore.PrivateKey();
  const userAddr = userPrivKey.toAddress('testnet');
  logger.debug(`user address: ${userAddr.toString()}`);

  const faucetStartHeight = await btcChain.getBtcHeight();
  // transfer from miner to user addr
  const faucetTxHash = await client.sendtoaddress(
    {
      address: userAddr.toString(),
      amount: 0.01,
    },
    'miner',
  );
  let confirmHeight = await btcChain.getBtcHeight();
  while (faucetStartHeight + 10 > confirmHeight) {
    await asyncSleep(1000 * 10);
    confirmHeight = await btcChain.getBtcHeight();
  }

  const lockStartHeight = await btcChain.getBtcHeight();
  const LockEventReceipent = 'ckt1qyqyph8v9mclls35p6snlaxajeca97tc062sa5gahk';
  const lockAmount = 500000;
  const feeRate = await getBtcMainnetFee();
  const lockTxHash = await btcChain.sendLockTxs(
    userAddr.toString(),
    lockAmount,
    userPrivKey,
    LockEventReceipent + 'do lock',
    feeRate.fastestFee,
  );
  logger.info(
    `user ${userAddr.toString()} lock 50000 satoshis; the lock tx hash is ${lockTxHash} after block ${lockStartHeight}`,
  );
  let latestHeight = await btcDb.getLatestHeight();
  while (latestHeight < lockStartHeight) {
    await asyncSleep(1000 * 10);
    latestHeight = await btcDb.getLatestHeight();
  }
  const waitTimeout = 1000 * 60 * 5;
  await waitFnCompleted(
    waitTimeout,
    async (): Promise<boolean> => {
      const btcLockRecords = await conn.manager.find(BtcLock, {
        where: {
          txHash: lockTxHash,
        },
      });
      const ckbMintRecords = await conn.manager.find(CkbMint, {
        where: {
          id: lockTxHash,
        },
      });
      if (btcLockRecords.length == 0 || ckbMintRecords.length === 0) {
        return false;
      }

      logger.info('btcLockRecords', btcLockRecords);
      logger.info('CkbMintRecords', ckbMintRecords);

      assert(btcLockRecords.length === 1);
      const btcLockRecord = btcLockRecords[0];
      assert(btcLockRecord.amount === lockAmount.toString());

      assert(ckbMintRecords.length === 1);
      const ckbMintRecord = ckbMintRecords[0];
      assert(ckbMintRecord.chain === ChainType.BTC);
      return ckbMintRecord.status === 'success';
    },
    1000 * 10,
  );

  // check sudt balance.
  const account = new Account(PRI_KEY);
  const ownLockHash = ckb.utils.scriptToHash(<CKBComponents.Script>await account.getLockscript());
  const asset = new BtcAsset('btc', ownLockHash);
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

      logger.info('sudt balance:', balance);
      logger.info('expect balance:', new Amount(lockAmount.toString(), 0));
      return balance.eq(new Amount(lockAmount.toString(), 0));
    },
    1000 * 10,
  );

  const burnAmount = new Amount('100000', 0);
  // const account = new Account(PRI_KEY);
  // const ownLockHash = ckb.utils.scriptToHash(<CKBComponents.Script>await account.getLockscript());
  const generator = new CkbTxGenerator(ckb, new IndexerCollector(indexer));
  const burnTx = await generator.burn(
    await account.getLockscript(),
    userAddr.toString(),
    new BtcAsset('btc', ownLockHash),
    burnAmount,
  );
  const signedTx = ckb.signTransaction(PRI_KEY)(burnTx);
  const burnTxHash = await ckb.rpc.sendTransaction(signedTx);
  console.info(`burn Transaction has been sent with tx hash ${burnTxHash}`);
  await waitUntilCommitted(ckb, burnTxHash, 60);

  await waitFnCompleted(
    waitTimeout,
    async (): Promise<boolean> => {
      const balance = await collector.getSUDTBalance(
        new Script(sudtType.codeHash, sudtType.args, sudtType.hashType),
        await account.getLockscript(),
      );

      logger.info('sudt balance:', balance);
      logger.info('expect balance:', new Amount(lockAmount.toString(), 0).sub(burnAmount));
      return balance.eq(new Amount(lockAmount.toString(), 0).sub(burnAmount));
    },
    1000 * 10,
  );

  await waitFnCompleted(
    waitTimeout,
    async () => {
      const btcUnlockRecords = await conn.manager.find(BtcUnlock, {
        where: {
          ckbTxHash: burnTxHash,
          status: 'success',
        },
      });
      if (btcUnlockRecords.length === 0) {
        return false;
      }
      logger.info('btcUnlockRecords', btcUnlockRecords);
      assert(btcUnlockRecords.length === 1);
      const eosUnlockRecord = btcUnlockRecords[0];
      assert(eosUnlockRecord.recipientAddress == userAddr.toString());
      logger.info('amount: ', eosUnlockRecord.amount);
      logger.info('amount: ', burnAmount.toString(0));
      assert(eosUnlockRecord.amount === burnAmount.toString(0));
      return true;
    },
    1000 * 10,
  );

  const lockRecords: BtcLock[] = await btcDb.getLockRecordByHash(lockTxHash);
  logger.info(`successful lock records ${JSON.stringify(lockRecords, null, 2)}`);
  const unlockRecords: BtcUnlock[] = await btcDb.getBtcUnlockRecords('success');
  logger.info(`successful unlock records  ${JSON.stringify(unlockRecords, null, 2)}`);
  assert(lockRecords[0].data.startsWith(LockEventReceipent));
  assert(unlockRecords[0].recipientAddress === userAddr.toString());
  logger.info('end btc test lock and unlock');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
