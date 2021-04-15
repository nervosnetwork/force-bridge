// invoke in tron handler
import {
  CkbMint,
  TronLock,
  TronUnlock,
  ICkbMint,
  ITronLock,
  IQuery,
  LockRecord,
  UnlockRecord,
} from '@force-bridge/db/model';
import { Connection, Repository } from 'typeorm';
import { TronUnlockStatus } from '@force-bridge/db/entity/TronUnlock';

export class TronDb implements IQuery {
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

  async createTronLock(records: ITronLock[]): Promise<void> {
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

  async getLockRecordsByUser(userAddr: string): Promise<LockRecord[]> {
    return await this.connection.manager.query(
      `select tron.sender as sender, ckb.recipient_lockscript as recipient , tron.amount as lock_amount,ckb.amount as mint_amount,tron.tx_hash as lock_hash FROM tron_lock tron join ckb_mint ckb on tron.tx_hash = ckb.id where tron.sender = ?`,
      [userAddr],
    );
  }

  async getUnlockRecordsByUser(ckbLockScriptHash: string): Promise<UnlockRecord[]> {
    return await this.connection.manager.query(
      `select ckb.sender_lock_hash as sender, ckb.recipient_address as recipient , ckb.amount as burn_amount, tron.amount as unlock_amount,ckb.ckb_tx_hash as burn_hash,tron.tron_tx_hash as unlock_hash FROM tron_unlock tron join ckb_burn ckb on tron.ckb_tx_hash = ckb.ckb_tx_hash where tron.status = 'success' and ckb.sender_lock_hash = ?`,
      [ckbLockScriptHash],
    );
  }
}
