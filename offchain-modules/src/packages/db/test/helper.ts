import os from 'os';
import { createConnection } from 'typeorm';
import { CkbMint } from '@force-bridge/db/entity/CkbMint';
import { CkbBurn } from '@force-bridge/db/entity/CkbBurn';

export async function getTmpConnection(path: string = `${os.tmpdir()}/db.sqlite`) {
  const connection = await createConnection({
    type: 'sqlite',
    database: path,
    entities: [CkbBurn, CkbMint],
    synchronize: true,
    logging: true,
  });
  return {
    path,
    connection,
  };
}
