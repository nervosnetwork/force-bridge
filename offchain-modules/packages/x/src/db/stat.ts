import { Connection, MoreThan } from 'typeorm';
import { CkbBurn } from './entity/CkbBurn';

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
}
