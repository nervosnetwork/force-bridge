// invoke in ckb handler
import { Connection } from 'typeorm';
import { CkbMint, CkbBurn, EthUnlock } from '@force-bridge/db/model';

export class CkbDb {
  constructor(private connection: Connection) {}
  // invoke when getting new burn events
  async saveCkbBurn(records: CkbBurn[]): Promise<void> {
    await this.connection.manager.save(records);
  }

  async getCkbMintRecordsToMint(take: number = 100): Promise<CkbMint[]> {
    return await this.connection.getRepository(CkbMint).find({
      where: {
        status: 'pending',
      },
      take,
    });
  }

  // update mint status
  async updateCkbMint(records: CkbMint[]): Promise<void> {
    await this.connection.manager.save(records);
  }

  /* save chain specific data */
  async createEthUnlock(records: EthUnlock[]): Promise<void> {
    await this.connection.manager.save(records);
  }
}
