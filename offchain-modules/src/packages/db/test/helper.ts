import os from 'os';
import { createConnection } from 'typeorm';
import { EthLock, CkbMint, CkbBurn, EthUnlock, TronLock, TronUnlock } from '@force-bridge/db/model';
import { genRandomHex } from '@force-bridge/utils';

export async function getTmpConnection(path: string = `${os.tmpdir()}/${genRandomHex(32)}/db.sqlite`) {
  const connection = await createConnection({
    type: 'sqlite',
    database: path,
    entities: [CkbBurn, CkbMint, EthLock, EthUnlock, TronLock, TronUnlock],
    synchronize: true,
    logging: true,
  });
  return {
    path,
    connection,
  };
}
