import { Connection, MoreThan } from 'typeorm';
import { CkbBurn } from './entity/CkbBurn';
import { CollectorEthUnlock } from './entity/EthUnlock';

export class StatDb {
  constructor(private connection: Connection) {}

  // calculate from now - interval seconds
  async getCkbBurn(interval: number): Promise<CkbBurn[]> {
    return await this.connection.getRepository(CkbBurn).find({
      where: {
        createdAt: MoreThan(new Date(Date.now() - interval * 1000)),
      },
    });
  }

  // get CollectorEthUnlocks status manual-review
  async getManualReviewCollectorEthUnlocks(): Promise<CollectorEthUnlock[]> {
    return await this.connection.getRepository(CollectorEthUnlock).find({
      where: {
        status: 'manual-review',
      },
    });
  }
}
