import 'module-alias/register';
import { logger } from '@force-bridge/utils/logger';
import { RPCClient } from 'rpc-bitcoin';
import bitcore from 'bitcore-lib';
import { asyncSleep } from '@force-bridge/utils';
import { createConnection } from 'typeorm';
import { CkbDb } from '@force-bridge/db';
import { Config } from '@force-bridge/config';
import { BTCChain, getBtcMainnetFee } from '@force-bridge/xchain/btc';
import { BtcDb } from '@force-bridge/db/btc';
import { BtcAsset, ChainType } from '@force-bridge/ckb/model/asset';
import nconf from 'nconf';
import { ForceBridgeCore } from '@force-bridge/core';
import assert from 'assert';
import { BtcUnlock } from '@force-bridge/db/entity/BtcUnlock';
import { BtcLock } from '@force-bridge/db/entity/BtcLock';
import { CkbMint } from '@force-bridge/db/model';
import { Amount, Script } from '@lay2/pw-core';
import { CkbTxGenerator } from '@force-bridge/ckb/tx-helper/generator';
import { IndexerCollector } from '@force-bridge/ckb/tx-helper/collector';
import { CkbIndexer } from '@force-bridge/ckb/tx-helper/indexer';
import { Account } from '@force-bridge/ckb/model/accounts';
import { waitUntilCommitted, waitFnCompleted } from './util';
const CKB = require('@nervosnetwork/ckb-sdk-core').default;

const CKB_URL = process.env.CKB_URL || 'http://127.0.0.1:8114';
const indexer = new CkbIndexer('http://127.0.0.1:8114', 'http://127.0.0.1:8116');
const collector = new IndexerCollector(indexer);
const ckb = new CKB(CKB_URL);

async function main() {
  logger.debug('start btc test lock and unlock');

  const conn = await createConnection();
  const btcDb = new BtcDb(conn);
  const ckbDb = new CkbDb(conn);

  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const config: Config = nconf.get('forceBridge');
  logger.debug(`config: ${config}`);
  // init bridge force core
  await new ForceBridgeCore().init(config);
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
  logger.debug(
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

      logger.debug('btcLockRecords', btcLockRecords);
      logger.debug('CkbMintRecords', ckbMintRecords);

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

      logger.debug('sudt balance:', balance);
      logger.debug('expect balance:', new Amount(lockAmount.toString()));
      return balance.eq(new Amount(lockAmount.toString()));
    },
    1000 * 10,
  );

  const burnAmount = new Amount('100000');
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
  console.log(`burn Transaction has been sent with tx hash ${burnTxHash}`);
  await waitUntilCommitted(ckb, burnTxHash, 60);

  await waitFnCompleted(
    waitTimeout,
    async (): Promise<boolean> => {
      const balance = await collector.getSUDTBalance(
        new Script(sudtType.codeHash, sudtType.args, sudtType.hashType),
        await account.getLockscript(),
      );

      logger.debug('sudt balance:', balance);
      logger.debug('expect balance:', new Amount(lockAmount.toString()).sub(burnAmount));
      return balance.eq(new Amount(lockAmount.toString()).sub(burnAmount));
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
      logger.debug('btcUnlockRecords', btcUnlockRecords);
      assert(btcUnlockRecords.length === 1);
      const eosUnlockRecord = btcUnlockRecords[0];
      assert(eosUnlockRecord.recipientAddress == userAddr.toString());
      logger.debug('amount: ', eosUnlockRecord.amount);
      logger.debug('amount: ', burnAmount.toString());
      assert(eosUnlockRecord.amount === burnAmount.toString());
      return true;
    },
    1000 * 10,
  );

  const lockRecords: BtcLock[] = await btcDb.getLockRecord(lockTxHash);
  logger.debug(`successful lock records ${JSON.stringify(lockRecords, null, 2)}`);
  const unlockRecords: BtcUnlock[] = await btcDb.getBtcUnlockRecords('success');
  logger.debug(`successful unlock records  ${JSON.stringify(unlockRecords, null, 2)}`);
  assert(lockRecords[0].data.startsWith(LockEventReceipent));
  assert(unlockRecords[0].recipientAddress === userAddr.toString());
  logger.debug('end btc test lock and unlock');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
