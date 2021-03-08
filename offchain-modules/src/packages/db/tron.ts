// invoke in tron handler
import { CkbMint, TronLock, TronUnlock } from '@force-bridge/db/model';
import { Connection } from 'typeorm';

export class TronDb {
  constructor(private connection: Connection) {}
  async createCkbMint(records: CkbMint[]): Promise<void> {
    await this.connection.manager.save(records);
  }

  async getCkbMint(limit: number = 100): Promise<CkbMint[]> {
    let ckbMintRepository = this.connection.getRepository(CkbMint);
    return await ckbMintRepository.find({
      where: {
        chain: 1,
      },
      order: {
        updated_at: 'DESC',
      },
      take: limit,
    });
  }

  async saveTronLock(records: TronLock[]): Promise<void> {
    await this.connection.manager.save(records);
  }

  async getTronLock(limit: number = 100): Promise<TronLock[]> {
    let tronLockRepository = this.connection.getRepository(TronLock);
    return await tronLockRepository.find({
      order: {
        updated_at: 'DESC',
      },
      take: limit,
    });
  }

  async saveTronUnlock(records: TronUnlock[]): Promise<void> {
    await this.connection.manager.save(records);
  }

  async getTronUnlockRecordsToUnlock(limit: number = 100): Promise<TronUnlock[]> {
    let tronUnlockRepository = this.connection.getRepository(TronUnlock);
    return await tronUnlockRepository.find({
      where: {
        status: 'pending',
      },
      order: {
        updated_at: 'DESC',
      },
      take: limit,
    });
  }
}
