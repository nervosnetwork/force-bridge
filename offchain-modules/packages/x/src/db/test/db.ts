import anyTest, { TestInterface } from 'ava';
import { Connection } from 'typeorm';
import { CkbDb, EthDb } from '..';
import { getTmpConnection } from './helper';

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
    sudtExtraData: '0x01',
  };
  // const ckbMintRecord = ckbMintRepo.create(data);
  // await ckbMintRepo.save([ckbMintRecord]);
  await ethDb.createCollectorCkbMint([data]);
  const ckbMintRecordGet = await ckbDb.getCkbMintRecordsToMint('todo');
  t.is(ckbMintRecordGet.length, 1);
  t.like(ckbMintRecordGet[0], data);
});
