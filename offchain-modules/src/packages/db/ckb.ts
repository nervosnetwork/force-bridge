// invoke in ckb handler
import { Connection } from 'typeorm';
import { CkbMint, CkbBurn, EthUnlock, IEthUnlock } from '@force-bridge/db/model';

export class CkbDb {
  constructor(private connection: Connection) {}
  // invoke when getting new burn events
  async saveCkbBurn(records: CkbBurn[]): Promise<void> {
    await this.connection.manager.save(records);
  }

  async getCkbMintRecordsToMint(take = 100): Promise<CkbMint[]> {
    return this.connection.getRepository(CkbMint).find({
      where: {
        status: 'todo',
      },
      take,
    });
  }

  // update mint status
  async updateCkbMint(records: CkbMint[]): Promise<void> {
    await this.connection.manager.save(records);
  }

  /* save chain specific data */
  async createEthUnlock(records: IEthUnlock[]): Promise<void> {
    const ethUnlockRepo = this.connection.getRepository(EthUnlock);
    const dbRecords = records.map((r) => ethUnlockRepo.create(r));
    await ethUnlockRepo.save(dbRecords);
  }
}
