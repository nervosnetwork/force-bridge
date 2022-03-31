import { Connection, MoreThan } from 'typeorm';
import { CkbBurn } from './entity/CkbBurn';
import { EthBurn } from './entity/EthBurn';

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

  async getEthBurn(interval: number): Promise<EthBurn[]> {
    return await this.connection.getRepository(EthBurn).find({
      where: {
        createdAt: MoreThan(new Date(Date.now() - interval * 1000)),
      },
    });
  }
}
