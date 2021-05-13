import anyTest, { TestInterface } from 'ava';
import { getTmpConnection } from './helper';
import { CkbBurn } from '@force-bridge/db/entity/CkbBurn';
import { Connection, getRepository } from 'typeorm';
import { CkbDb, EthDb } from '@force-bridge/db';
import { CkbMint } from '@force-bridge/db/entity/CkbMint';

const test = anyTest as TestInterface<{
  path: string;
  connection: Connection;
}>;

test.beforeEach(async (t) => {
  const { path, connection } = await getTmpConnection();
  t.context = { path, connection };
});

test('ckb db works', async (t) => {
  const conn = t.context.connection;
  const ckbDb = new CkbDb(conn);
  const ethDb = new EthDb(conn);

  // const ckbMintRepo = getRepository(CkbMint);
  const data = {
    id: 'unique-id',
    chain: 1,
    amount: '0x01',
    asset: '0x00000000000000000000',
    recipientLockscript: '0x00000000000000000001',
  };
  // const ckbMintRecord = ckbMintRepo.create(data);
  // await ckbMintRepo.save([ckbMintRecord]);
  await ethDb.createCkbMint([data]);
  const ckbMintRecordGet = await ckbDb.getCkbMintRecordsToMint();
  t.is(ckbMintRecordGet.length, 1);
  t.like(ckbMintRecordGet[0], data);
});
