import anyTest, { TestInterface } from 'ava';
import { CkbDb } from './ckb';
import { getTmpConnection } from './test/helper';
import { CkbBurn } from '@force-bridge/db/entity/CkbBurn';
import { Connection } from 'typeorm';

const test = anyTest as TestInterface<{
  path: string;
  connection: Connection;
}>;

test.beforeEach(async (t) => {
  const { path, connection } = await getTmpConnection();
  t.context = { path, connection };
});

test('ckb db works', async (t) => {
  const manager = t.context.connection.manager;
  // save db
  const data = {
    amount: '0x1',
    asset: '0x00000000000000000000',
    chain: 0,
    ckbTxHash: '0x12',
    recipientAddress: '',
    blockNumber: 100,
    senderLockHash: '0x12',
  };
  const ckbBurn = new CkbBurn().from(data);
  await manager.save(ckbBurn);
  // get db
  const ckbBurnRecords = await manager.find(CkbBurn);
  t.is(ckbBurnRecords.length, 1);
  t.like(ckbBurnRecords[0], data);
});
