// invoke in BTC handler
import { CkbMint, BtcLock, BtcUnlock, ICkbMint, IBtcLock, IBtcUnLock } from '@force-bridge/db/model';
import { Connection, Not, Repository } from 'typeorm';
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
  async createBtcUnlock(records: IBtcUnLock[]): Promise<void> {
    const dbRecords = records.map((r) => this.btcUnlockRepository.create(r));
    await this.btcUnlockRepository.save(dbRecords);
  }

  async saveBtcUnlock(records: BtcUnlock[]): Promise<void> {
    await this.btcUnlockRepository.save(records);
  }

  async createBtcLock(records: IBtcLock[]): Promise<void> {
    const dbRecords = records.map((r) => this.btcLockRepository.create(r));
    await this.btcLockRepository.save(dbRecords);
  }

  async getNotSuccessUnlockRecord(ckbTxHash): Promise<BtcUnlock[]> {
    const successStatus: BtcUnlockStatus = 'success';
    return await this.btcUnlockRepository.find({
      status: Not(successStatus),
      ckbTxHash: ckbTxHash,
    });
  }

  async getLockRecord(btcLockHash): Promise<BtcLock[]> {
    return await this.btcLockRepository.find({
      txHash: btcLockHash,
    });
  }

  async getBtcUnlockRecords(status: BtcUnlockStatus, take = 2): Promise<BtcUnlock[]> {
    return this.btcUnlockRepository.find({
      where: {
        status,
      },
      take,
    });
  }
}
