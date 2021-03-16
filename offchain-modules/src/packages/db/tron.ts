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

  async getLatestLockRecords(): Promise<TronLock[]> {
    const qb = this.connection.getRepository(TronLock).createQueryBuilder('lock');
    return qb
      .where('lock.timestamp=' + qb.subQuery().select('MAX(lock.timestamp)').from(TronLock, 'lock').getQuery())
      .getMany();
  }

  async getTronUnlockRecords(status: TronUnlockStatus, limit = 100): Promise<TronUnlock[]> {
    const tronUnlockRepository = this.connection.getRepository(TronUnlock);
    return await tronUnlockRepository.find({
      where: {
        status: status,
      },
      take: limit,
    });
  }
}
