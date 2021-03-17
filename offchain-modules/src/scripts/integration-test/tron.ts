import 'module-alias/register';
import nconf from 'nconf';
import { TronConfig } from '@force-bridge/config';
import { logger } from '@force-bridge/utils/logger';
import { asyncSleep } from '@force-bridge/utils';
import { createConnection } from 'typeorm';
import { CkbDb, TronDb } from '@force-bridge/db';
import { CkbMint, TronLock } from '@force-bridge/db/model';
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
  const tronDb = new TronDb(conn);
  const ckbDb = new CkbDb(conn);

  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const config: TronConfig = nconf.get('forceBridge:tron');
  logger.debug('config', config);

  const tronWeb = new TronWeb({
    fullHost: config.tronGridUrl,
  });

  const from = 'TS6VejPL8cQy6pA8eDGyusmmhCrXHRdJK6';
  const to = config.committee.address;
  const amount = 100;
  const recipientLockscript = '0x00';
  const sudtExtraData = '0x01';
  const memo = recipientLockscript.concat(sudtExtraData);

  const lockRes = await transferTrx(tronWeb, from, to, amount, memo, config.privateKey);
  logger.debug('lockRes', lockRes);
  const txHash = lockRes.txID;

  // // create eth unlock
  // const recipientAddress = '0x1000000000000000000000000000000000000001';
  // const balanceBefore = await provider.getBalance(recipientAddress);
  // logger.debug('balanceBefore', balanceBefore);
  // const record = {
  //   ckbTxHash: genRandomHex(32),
  //   asset: ETH_ADDRESS,
  //   amount: genRandomHex(4),
  //   recipientAddress,
  // };
  // await ckbDb.createEthUnlock([record]);

  const checkEffect = async () => {
    // check EthLock and CkbMint saved.
    const tronLockRecords = await conn.manager.find(TronLock, {
      where: {
        tronLockTxHash: txHash,
      },
    });
    logger.debug('ethLockRecords', tronLockRecords);
    assert(tronLockRecords.length === 1);
    const tronLockRecord = tronLockRecords[0];

    assert(tronLockRecord.memo === memo);
    assert(tronLockRecord.tronSender === from);
    assert(tronLockRecord.asset === 'trx');
    assert(tronLockRecord.assetType === 'trx');

    const ckbMintRecords = await conn.manager.find(CkbMint, {
      where: {
        id: txHash,
      },
    });
    logger.debug('ckbMintRecords', ckbMintRecords);
    assert(ckbMintRecords.length === 1);
    const ckbMintRecord = ckbMintRecords[0];
    assert(ckbMintRecord.chain === ChainType.ETH);
    assert(ckbMintRecord.sudtExtraData === sudtExtraData);
    assert(ckbMintRecord.status === 'todo');
    assert(ckbMintRecord.asset === 'trx');
    assert(ckbMintRecord.amount === amount.toString());
    assert(ckbMintRecord.recipientLockscript === recipientLockscript);

    // // check unlock record send
    // const ethUnlockRecords = await conn.manager.find(EthUnlock, {
    //   where: {
    //     ckbTxHash: record.ckbTxHash,
    //   },
    // });
    // assert(ethUnlockRecords.length === 1);
    // const ethUnlockRecord = ethUnlockRecords[0];
    // assert(ethUnlockRecord.status === 'success');
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
    await asyncSleep(3000);
    try {
      await checkEffect();
    } catch (e) {
      logger.warn('The eth component integration not pass yet.', { i, e });
      continue;
    }
    logger.info('The eth component integration test pass!');
    return;
  }
  throw new Error('The eth component integration test failed!');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
