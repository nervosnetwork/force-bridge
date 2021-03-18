import anyTest, { TestInterface } from 'ava';
import { getTmpConnection } from './test/helper';
import { TronDb } from '@force-bridge/db/tron';
import { TronLock } from './entity/TronLock';
import { TronUnlock } from './model';

const test = anyTest as TestInterface<{
  db: TronDb;
}>;

test.beforeEach(async (t) => {
  const { connection } = await getTmpConnection();
  const db: TronDb = new TronDb(connection);
  t.context = { db };
});

// test('tron db TronLock', async (t) => {
//   // save db
//   const data = {
//     tronLockTxHash: '0x0',
//     tronLockIndex: 0,
//     tronSender: '0x0',
//     asset: 'TRX',
//     assetType: 'trx',
//     amount: '0x1',
//     memo: 'lock 1 TRX',
//     timestamp: 1612603926000,
//     committee: '0x0000000000000000000000000000000000000000',
//   };
//   const tronLock_1 = new TronLock().from(data);

//   data.timestamp = 1612603926001;
//   data.tronLockIndex = 1;
//   const tronLock_2 = new TronLock().from(data);

//   await t.context.db.createTronLock([tronLock_1, tronLock_2]);

//   const latestLockRecords = await t.context.db.getLatestLockRecords();
//   t.is(latestLockRecords.length, 1);
//   t.is(latestLockRecords[0].timestamp, 1612603926001);
// });

// test('tron db TronUnlock', async (t) => {
//   // save db
//   const data = {
//     asset: 'TLBaRhANQoJFTqre9Nf1mjuwNWjCJeYqUL',
//     assetType: 'trc20',
//     amount: '0x1',
//     memo: 'unlock 1 TRX_SUDT',
//     tronRecipientAddress: '0x0000000000000000000000000000000000000000',
//     committee: '0x0000000000000000000000000000000000000000',
//   };
//   const tronUnlock = new TronUnlock().from(data);
//   await t.context.db.saveTronUnlock([tronUnlock]);
//   // get db
//   let tronUnlockRecords = await t.context.db.getTronUnlockRecords('init');
//   t.is(tronUnlockRecords.length, 1);
//   t.like(tronUnlockRecords[0], data);

//   tronUnlockRecords[0].status = 'pending';
//   await t.context.db.saveTronUnlock(tronUnlockRecords);

//   tronUnlockRecords = await t.context.db.getTronUnlockRecords('init');
//   t.is(tronUnlockRecords.length, 0);

//   tronUnlockRecords = await t.context.db.getTronUnlockRecords('pending');
//   t.is(tronUnlockRecords.length, 1);
//   t.like(tronUnlockRecords[0], data);
// });
