import anyTest, { TestInterface } from 'ava';
import { CkbDb } from './ckb';
import { getTmpConnection } from '@force-bridge/db/helper';
import { CkbBurn } from '@force-bridge/db/entity/CkbBurn';
import { Connection } from 'typeorm';

const test = anyTest as TestInterface<{
  tmpdir: string;
  connection: Connection;
}>;

test.beforeEach(async (t) => {
  const { tmpdir, connection } = await getTmpConnection();
  console.log({ tmpdir });
  t.context = { tmpdir, connection };
});

test('ckb db works', async (t) => {
  const manager = t.context.connection.manager;
  // save db
  const data = {
    amount: '0x1',
    asset: '0x00000000000000000000',
    chain: 0,
    tx_hash: '0x12',
    memo: '',
  };
  let ckbBurn = new CkbBurn().from(data);
  await manager.save(ckbBurn);
  // get db
  const ckbBurnRecords = await manager.find(CkbBurn);
  t.is(ckbBurnRecords.length, 1);
  t.like(ckbBurnRecords[0], data);
});
