import os from 'os';
import { createConnection } from 'typeorm';
import { CkbMint } from '@force-bridge/db/entity/CkbMint';
import { CkbBurn } from '@force-bridge/db/entity/CkbBurn';

export async function getTmpConnection() {
  const tmpdir = os.tmpdir();
  const connection = await createConnection({
    type: 'sqlite',
    database: `${tmpdir}/db.sqlite`,
    entities: [CkbBurn, CkbMint],
    synchronize: true,
    logging: false,
  });
  return {
    tmpdir,
    connection,
  };
}
