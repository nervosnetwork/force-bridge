// invoke in eos handler

import { Connection, Repository } from 'typeorm';
import { CkbMint, EosUnlock, EosLock, ICkbMint, IEosLock } from '@force-bridge/db/model';
import { EosUnlockStatus } from '@force-bridge/db/entity/EosUnlock';

export class EosDb {
  private ckbMintRepository: Repository<CkbMint>;
  private eosLockRepository: Repository<EosLock>;
  private eosUnlockRepository: Repository<EosUnlock>;

  constructor(private conn: Connection) {
    this.ckbMintRepository = conn.getRepository(CkbMint);
    this.eosLockRepository = conn.getRepository(EosLock);
    this.eosUnlockRepository = conn.getRepository(EosUnlock);
  }

  async getLastedAccountActionSeq(): Promise<number> {
    const rawRes = await this.conn.manager.query('select max(account_action_seq) as lasted_account_seq from eos_lock');
    return rawRes[0].lasted_account_seq || -1;
  }

  async createCkbMint(records: ICkbMint[]): Promise<void> {
    const dbRecords = records.map((r) => this.ckbMintRepository.create(r));
    await this.ckbMintRepository.save(dbRecords);
  }

  async saveEosUnlock(records: EosUnlock[]): Promise<void> {
    await this.eosUnlockRepository.save(records);
  }

  async createEosLock(records: IEosLock[]): Promise<void> {
    const dbRecords = records.map((r) => this.eosLockRepository.create(r));
    await this.eosLockRepository.save(dbRecords);
  }

  async getEosUnlockRecordsToUnlock(status: EosUnlockStatus, take = 1): Promise<EosUnlock[]> {
    return this.eosUnlockRepository.find({
      where: {
        status,
      },
      take,
    });
  }
}
