// invoke in BTC handler
import { CkbMint, BtcLock, BtcUnlock, ICkbMint, IBtcLock } from '@force-bridge/db/model';
import { Connection, Repository } from 'typeorm';
import { BtcUnlockStatus } from '@force-bridge/db/entity/BtcUnlock';

export class BtcDb {
  private ckbMintRepository: Repository<CkbMint>;
  private btcLockRepository: Repository<BtcLock>;
  private btcUnlockRepository: Repository<BtcUnlock>;

  constructor(private connection: Connection) {
    this.ckbMintRepository = connection.getRepository(CkbMint);
    this.btcLockRepository = connection.getRepository(BtcLock);
    this.btcUnlockRepository = connection.getRepository(BtcUnlock);
  }

  async getLatestHeight(): Promise<number> {
    const rawRes = await this.connection.manager.query('select max(block_height) as max_block_number from btc_lock');
    return rawRes[0].max_block_number || 1;
  }

  async createCkbMint(records: ICkbMint[]): Promise<void> {
    const dbRecords = records.map((r) => this.ckbMintRepository.create(r));
    await this.ckbMintRepository.save(dbRecords);
  }

  async saveBtcUnlock(records: BtcUnlock[]): Promise<void> {
    await this.btcLockRepository.save(records);
  }

  async createBtcLock(records: IBtcLock[]): Promise<void> {
    const dbRecords = records.map((r) => this.btcLockRepository.create(r));
    await this.btcLockRepository.save(dbRecords);
  }

  async getBtcUnlockRecords(status: BtcUnlockStatus, take = 1): Promise<BtcUnlock[]> {
    return this.btcUnlockRepository.find({
      where: {
        status,
      },
      take,
    });
  }
}
