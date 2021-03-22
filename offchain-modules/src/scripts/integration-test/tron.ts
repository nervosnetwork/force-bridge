import 'module-alias/register';
import nconf from 'nconf';
import { TronConfig } from '@force-bridge/config';
import { logger } from '@force-bridge/utils/logger';
import { asyncSleep, genRandomHex } from '@force-bridge/utils';
import { createConnection } from 'typeorm';
import { CkbDb, TronDb } from '@force-bridge/db';
import { CkbMint, TronLock, TronUnlock } from '@force-bridge/db/model';
import assert from 'assert';
import { ChainType } from '@force-bridge/ckb/model/asset';
const TronWeb = require('tronweb');

async function transferTrx(tronWeb, from, to, amount, memo, priv) {
  const from_hex = tronWeb.address.toHex(from);
  const to_hex = tronWeb.address.toHex(to);

  const unsigned_tx = await tronWeb.transactionBuilder.sendTrx(to_hex, amount, from_hex);
  const unsignedWithMemoTx = await tronWeb.transactionBuilder.addUpdateData(unsigned_tx, memo, 'utf8');

  const signed_tx = await tronWeb.trx.sign(unsignedWithMemoTx, priv);
  const broad_tx = await tronWeb.trx.broadcast(signed_tx);

  return broad_tx;
}

async function main() {
  const conn = await createConnection();
  const ckbDb = new CkbDb(conn);

  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const config: TronConfig = nconf.get('forceBridge:tron');
  logger.debug('config', config);

  const tronWeb = new TronWeb({
    fullHost: config.tronGridUrl,
  });

  const userPrivateKey = 'AECC2FBC0BF175DDD04BD1BC3B64A13DB98738962A512544C89B50F5DDB7EBBD';
  const from = tronWeb.address.fromPrivateKey(userPrivateKey);
  const to = config.committee.address;
  const amount = 100;
  const recipientLockscript = 'ckt1qyq2f0uwf3lk7e0nthfucvxgl3zu36v6zuwq6mlzps';
  const sudtExtraData = 'transfer 100 to ckt1qyq2f0uwf3lk7e0nthfucvxgl3zu36v6zuwq6mlzps';
  const memo = recipientLockscript.concat(',').concat(sudtExtraData);
  const lockRes = await transferTrx(tronWeb, from, to, amount, memo, userPrivateKey);
  const txHash: string = lockRes.transaction.txID;

  // create tron unlock
  const recipientAddress = 'TS6VejPL8cQy6pA8eDGyusmmhCrXHRdJK6';
  const record = {
    ckbTxHash: genRandomHex(32),
    asset: 'trx',
    assetType: 'trx',
    amount: '100',
    recipientAddress,
  };
  await ckbDb.createTronUnlock([record]);

  const checkEffect = async () => {
    // check TronLock and CkbMint saved.
    const tronLockRecords = await conn.manager.find(TronLock, {
      where: {
        txHash: txHash,
      },
    });
    logger.debug('tronLockRecords', tronLockRecords);
    assert(tronLockRecords.length === 1);
    const tronLockRecord = tronLockRecords[0];

    assert(tronLockRecord.memo === memo);
    assert(tronLockRecord.sender === from);
    assert(tronLockRecord.asset === 'trx');
    assert(tronLockRecord.assetType === 'trx');

    const ckbMintRecords = await conn.manager.find(CkbMint, {
      where: {
        id: txHash.concat('_').concat(tronLockRecord.txIndex.toString()),
      },
    });
    logger.debug('ckbMintRecords', ckbMintRecords);
    assert(ckbMintRecords.length === 1);
    const ckbMintRecord = ckbMintRecords[0];
    assert(ckbMintRecord.chain === ChainType.TRON);
    assert(ckbMintRecord.sudtExtraData === sudtExtraData);
    assert(ckbMintRecord.status === 'todo');
    assert(ckbMintRecord.asset === 'trx');
    assert(ckbMintRecord.amount === amount.toString());
    assert(ckbMintRecord.recipientLockscript === recipientLockscript);

    // check unlock record send
    const tronUnlockRecords = await conn.manager.find(TronUnlock, {
      where: {
        ckbTxHash: record.ckbTxHash,
      },
    });
    assert(tronUnlockRecords.length === 1);
    const tronUnlockRecord = tronUnlockRecords[0];
    assert(tronUnlockRecord.status === 'success');

    // const unlockReceipt = await provider.getTransactionReceipt(ethUnlockRecord.ethTxHash);
    // logger.debug('unlockReceipt', unlockReceipt);
    // assert(unlockReceipt.logs.length === 1);
    // const parsedLog = iface.parseLog(unlockReceipt.logs[0]);
    // logger.debug('parsedLog', parsedLog);
    // assert(parsedLog.args.token === record.asset);
    // assert(record.amount === parsedLog.args.receivedAmount.toHexString());
    // assert(record.recipientAddress === parsedLog.args.recipient);
  };

  // try 100 times and wait for 3 seconds every time.
  for (let i = 0; i < 100; i++) {
    await asyncSleep(10000);
    try {
      await checkEffect();
    } catch (e) {
      logger.warn('The tron component integration not pass yet.', { i, e });
      continue;
    }
    logger.info('The tron component integration test pass!');
    return;
  }
  throw new Error('The tron component integration test failed!');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
