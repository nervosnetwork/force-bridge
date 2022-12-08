import { Connection, Repository } from 'typeorm';
import { Sudt } from './entity/sudt';

export class SudtDb {
  private sudtRepository: Repository<Sudt>;

  constructor(private connection: Connection) {
    this.sudtRepository = connection.getRepository(Sudt);
  }

  async createSudtTransferRecord(
    hash: string,
    direction: 'in' | 'out',
    address: string,
    sudtArgs: string,
    amount: string,
    index: number,
  ): Promise<void> {
    const record = this.sudtRepository.create({
      txHash: hash,
      direction: direction == 'in' ? 1 : -1,
      address,
      sudtArgs,
      amount,
      index,
    });
    await this.sudtRepository.save(record);
  }
}
