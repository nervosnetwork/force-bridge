// invoke in ckb handler
import { Connection } from 'typeorm';
import { CkbMint } from '@force-bridge/db/entity/CkbMint';
import { CkbBurn } from '@force-bridge/db/entity/CkbBurn';
import { EthUnlock } from '@force-bridge/db/entity/EthUnlock';

export class CkbDb {
  constructor(private connection: Connection) {}
  // invoke when getting new burn events
  async saveCkbBurn(records: CkbBurn[]): Promise<void> {
    await this.connection.manager.save(records);
  }

  async getCkbMintRecordsToMint(limit: number = 100): Promise<CkbMint[]> {
    throw new Error('Method not implemented.');
  }

  // update mint status
  async updateCkbMint(records: CkbMint[]): Promise<void> {
    throw new Error('Method not implemented.');
  }

  /* save chain specific data */
  async createEthUnlock(records: EthUnlock[]): Promise<void> {
    throw new Error('Method not implemented.');
  }
}
