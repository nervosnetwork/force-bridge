import 'module-alias/register';
import { logger } from '@force-bridge/utils/logger';
import { RPCClient } from 'rpc-bitcoin';
import bitcore from 'bitcore-lib';
import { asyncSleep } from '@force-bridge/utils';
import { createConnection } from 'typeorm';
import { CkbDb } from '@force-bridge/db';
import { Config } from '@force-bridge/config';
import { BTCChain } from '@force-bridge/xchain/btc';
import { BtcDb } from '@force-bridge/db/btc';
import { ChainType } from '@force-bridge/ckb/model/asset';
import nconf from 'nconf';
import { ForceBridgeCore } from '@force-bridge/core';
import assert from 'assert';
import { BtcUnlock } from '@force-bridge/db/entity/BtcUnlock';
import { BtcLock } from '@force-bridge/db/entity/BtcLock';
import { IBtcUnLock } from '@force-bridge/db/model';

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
  const core = await new ForceBridgeCore().init(config);
  const client = new RPCClient(config.btc.clientParams);
  let btcChain = new BTCChain();

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
  const LockEventReceipent = 'ckb1qyqz0a2fz6ay22990fwt3mwt3pgdzlnrnmyswcl503';
  const lockTxHash = await btcChain.sendLockTxs(userAddr.toString(), 500000, userPrivKey, LockEventReceipent);
  logger.debug(
    `user ${userAddr.toString()} lock 50000 satoshis; the lock tx hash is ${lockTxHash} after block ${lockStartHeight}`,
  );
  let latestHeight = await btcDb.getLatestHeight();
  while (latestHeight < lockStartHeight) {
    await asyncSleep(1000 * 10);
    latestHeight = await btcDb.getLatestHeight();
  }

  // the burn hash can't start with 0x. because it will save as hex string in op retrun output
  const ckbHashMissedADigit = '81fc10086606a5f4554e926bde2721452a962cda69550f2c16fe12b7deab25d'; // length 63 should 64
  // insert into btc_unlock for test unlock
  let unlockTask = [];
  for (let i = 0; i < 5; i++) {
    unlockTask.push({
      ckbTxHash: ckbHashMissedADigit + i,
      chain: ChainType.BTC,
      asset: 'btc',
      amount: '50000',
      recipientAddress: userAddr.toString(),
    });
  }
  await btcDb.createBtcUnlock(unlockTask);
  const ckbBurnHash = ckbHashMissedADigit + 0;
  let records: BtcUnlock[] = await btcDb.getNotSuccessUnlockRecord(ckbBurnHash);
  logger.debug(
    `database ckb burn data ${JSON.stringify(records, null, 2)}. the mock data ckb burn hash ${ckbBurnHash} `,
  );
  while (records.length != 0) {
    await asyncSleep(1000 * 10);
    records = await btcDb.getNotSuccessUnlockRecord(ckbBurnHash);
  }
  const lockRecords: BtcLock[] = await btcDb.getLockRecord(lockTxHash);
  logger.debug(`successful lock records ${JSON.stringify(lockRecords, null, 2)}`);
  const unlockRecords: BtcUnlock[] = await btcDb.getBtcUnlockRecords('success');
  logger.debug(`successful unlock records  ${JSON.stringify(unlockRecords, null, 2)}`);
  assert(lockRecords[0].data === LockEventReceipent);
  assert(unlockRecords[0].recipientAddress === userAddr.toString());
  logger.debug('end btc test lock and unlock');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
