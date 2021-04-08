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

async function transferTrc10(tronWeb, from, to, amount, tokenID, memo, priv) {
  const unsigned_tx = await tronWeb.transactionBuilder.sendToken(to, amount, tokenID, from);
  const unsignedWithMemoTx = await tronWeb.transactionBuilder.addUpdateData(unsigned_tx, memo, 'utf8');
  const signed_tx = await tronWeb.trx.sign(unsignedWithMemoTx, priv);
  const broad_tx = await tronWeb.trx.broadcast(signed_tx);
  return broad_tx;
}

async function transferTrc20(tronWeb, from, to, amount, contractAddress, memo, priv) {
  const options = {};
  const functionSelector = 'transfer(address,uint256)';
  const params = [
    { type: 'address', value: to },
    { type: 'uint256', value: amount },
  ];

  const unsigned_tx = await tronWeb.transactionBuilder.triggerSmartContract(
    contractAddress,
    functionSelector,
    options,
    params,
    from,
  );
  const unsignedWithMemoTx = await tronWeb.transactionBuilder.addUpdateData(unsigned_tx.transaction, memo, 'utf8');

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

  const trxLockRes = await transferTrx(tronWeb, from, to, amount, memo, userPrivateKey);
  const trxTxHash: string = trxLockRes.transaction.txID;

  const trc10LockRes = await transferTrc10(tronWeb, from, to, amount, '1000696', memo, userPrivateKey);
  const trc10TxHash: string = trc10LockRes.transaction.txID;

  const trc20LockRes = await transferTrc20(
    tronWeb,
    from,
    to,
    amount,
    'TVWvkCasxAJUyzPKMQ2Rus1NtmBwrkVyBR',
    memo,
    userPrivateKey,
  );
  const trc20TxHash: string = trc20LockRes.transaction.txID;

  // create tron unlock
  const recipientAddress = 'TS6VejPL8cQy6pA8eDGyusmmhCrXHRdJK6';
  const trxRecord = {
    ckbTxHash: genRandomHex(32),
    asset: 'trx',
    assetType: 'trx',
    amount: '100',
    recipientAddress,
  };
  const trc10Record = {
    ckbTxHash: genRandomHex(32),
    asset: '1000696',
    assetType: 'trc10',
    amount: '100',
    recipientAddress,
  };
  const trc20Record = {
    ckbTxHash: genRandomHex(32),
    asset: 'TVWvkCasxAJUyzPKMQ2Rus1NtmBwrkVyBR',
    assetType: 'trc20',
    amount: '100',
    recipientAddress,
  };
  await ckbDb.createTronUnlock([trxRecord, trc10Record, trc20Record]);

  const checkEffect = async (txHash, ckbTxHash, asset, assetType) => {
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
    assert(tronLockRecord.asset === asset);
    assert(tronLockRecord.assetType === assetType);

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
    assert(ckbMintRecord.asset === asset);
    assert(ckbMintRecord.amount === amount.toString());
    assert(ckbMintRecord.recipientLockscript === recipientLockscript);

    // check unlock record send
    const tronUnlockRecords = await conn.manager.find(TronUnlock, {
      where: {
        ckbTxHash: ckbTxHash,
      },
    });
    assert(tronUnlockRecords.length === 1);
    const tronUnlockRecord = tronUnlockRecords[0];
    assert(tronUnlockRecord.status === 'success');
  };

  // try 100 times and wait for 3 seconds every time.
  for (let i = 0; i < 100; i++) {
    await asyncSleep(10000);
    try {
      await checkEffect(trxTxHash, trxRecord.ckbTxHash, 'trx', 'trx');
      await checkEffect(trc10TxHash, trc10Record.ckbTxHash, '1000696', 'trc10');
      //await checkEffect(trc20TxHash, trc20Record.ckbTxHash, 'TVWvkCasxAJUyzPKMQ2Rus1NtmBwrkVyBR', 'trc20');
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
