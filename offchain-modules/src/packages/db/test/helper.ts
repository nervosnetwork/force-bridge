import os from 'os';
import { createConnection } from 'typeorm';
import { EthLock, CkbMint, CkbBurn, EthUnlock } from '@force-bridge/db/model';

export async function getTmpConnection(path: string = `${os.tmpdir()}/db.sqlite`) {
  const connection = await createConnection({
    type: 'sqlite',
    database: path,
    entities: [CkbBurn, CkbMint, EthLock, EthUnlock],
    synchronize: true,
    logging: true,
  });
  return {
    path,
    connection,
  };
}
