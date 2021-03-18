// invoke in tron handler
import { CkbMint, TronLock, TronUnlock, ICkbMint } from '@force-bridge/db/model';
import { Connection, Repository } from 'typeorm';
import { TronUnlockStatus } from '@force-bridge/db/entity/TronUnlock';

export class TronDb {
  private ckbMintRepository: Repository<CkbMint>;
  private tronLockRepository: Repository<TronLock>;
  private tronUnlockRepository: Repository<TronUnlock>;

  constructor(private connection: Connection) {
    this.ckbMintRepository = connection.getRepository(CkbMint);
    this.tronLockRepository = connection.getRepository(TronLock);
    this.tronUnlockRepository = connection.getRepository(TronUnlock);
  }

  async createCkbMint(records: ICkbMint[]): Promise<void> {
    const dbRecords = records.map((r) => this.ckbMintRepository.create(r));
    await this.ckbMintRepository.save(dbRecords);
  }

  async createTronLock(records: TronLock[]): Promise<void> {
    const dbRecords = records.map((r) => this.tronLockRepository.create(r));
    await this.tronLockRepository.save(dbRecords);
  }

  async saveTronUnlock(records: TronUnlock[]): Promise<void> {
    await this.tronUnlockRepository.save(records);
  }

  async getLatestTimestamp(): Promise<number> {
    const rawRes = await this.connection.manager.query('select max(timestamp) + 1 as max_timestamp from tron_lock');
    const max_timestamp: number = rawRes[0].max_timestamp || 1;
    return max_timestamp;
  }

  async getTronUnlockRecords(status: TronUnlockStatus): Promise<TronUnlock[]> {
    const tronUnlockRepository = this.connection.getRepository(TronUnlock);
    return await tronUnlockRepository.find({
      where: {
        status: status,
      },
    });
  }
}
