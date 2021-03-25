import 'module-alias/register';
import { logger } from '@force-bridge/utils/logger';
import { RPCClient } from 'rpc-bitcoin';
import bitcore from 'bitcore-lib';
import { asyncSleep, isEmptyArray } from '@force-bridge/utils';
import { createConnection } from 'typeorm';
import { CkbDb } from '@force-bridge/db';
import { Config } from '@force-bridge/config';
import { BTCChain } from '@force-bridge/xchain/btc';
import { BtcDb } from '@force-bridge/db/btc';
import { ChainType } from '@force-bridge/ckb/model/asset';
import nconf from 'nconf';
import { ForceBridgeCore } from '@force-bridge/core';

async function main() {
  logger.debug('start btc test');

  const conn = await createConnection();
  const btcDb = new BtcDb(conn);
  const ckbDb = new CkbDb(conn);

  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const config: Config = nconf.get('forceBridge');
  logger.debug('config', config);
  // init bridge force core
  const core = await new ForceBridgeCore().init(config);
  const client = new RPCClient(config.btc.clientParams);
  let btcChain = new BTCChain();

  const privKeys2 = config.btc.privateKeys.map((pk) => new bitcore.PrivateKey(pk.slice(2)));
  const pubKeys2 = privKeys2.map((pk) => pk.toPublicKey());
  const MultiSigAddress2 = bitcore.Address.createMultisig(pubKeys2, 2, 'testnet');
  logger.debug('MultiSigAddress', MultiSigAddress2.toString());

  // transfer to multisigAddr
  const userPrivKey = new bitcore.PrivateKey();
  const userAddr = userPrivKey.toAddress('testnet');
  console.log('userAddr', userAddr.toString());

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

  const lockTxHash = await btcChain.sendLockTxs(
    userAddr.toString(),
    50000,
    userPrivKey,
    'ckb1qyqz0a2fz6ay22990fwt3mwt3pgdzlnrnmyswcl503',
  );
  logger.debug(
    `user ${userAddr.toString()} lock 50000 satoshis; the lock tx hash is ${lockTxHash} after block ${lockStartHeight}`,
  );
  let latestHeight = await btcDb.getLatestHeight();
  while (latestHeight < lockStartHeight) {
    await asyncSleep(1000 * 10);
    latestHeight = await btcDb.getLatestHeight();
  }
  const lockRecord = await btcDb.getLockRecord(lockTxHash);
  logger.debug('latestHeight', latestHeight, 'lockRecord', lockRecord);

  const ckbBurnHash = '0x81fc10086606a5f4554e926bde2721452a962cda69550f2c16fe12b7deab25d5';
  // insert into btc_unlock for test unlock
  await btcDb.createBtcUnlock([
    {
      ckbTxHash: ckbBurnHash,
      chain: ChainType.BTC,
      asset: 'btc',
      amount: '5000',
      recipientAddress: userAddr.toString(),
    },
  ]);
  let data = await btcDb.getBtcUnlockRecords('todo');
  logger.debug(`database ckb burn hash ${data}. the mock data ckb burn hash ${ckbBurnHash} `);
  let records = await btcDb.getNotSuccessUnlockRecord(ckbBurnHash);
  while (!isEmptyArray(records)) {
    await asyncSleep(1000 * 10);
    records = await btcDb.getNotSuccessUnlockRecord(ckbBurnHash);
  }

  logger.debug('end btc demo');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
