// invoke in BTC handler
import {
  BtcLock,
  BtcUnlock,
  CkbMint,
  IBtcLock,
  IBtcUnLock,
  ICkbMint,
  IQuery,
  LockRecord,
  UnlockRecord,
} from '@force-bridge/db/model';
import { Connection, Not, Repository } from 'typeorm';
import { BtcUnlockStatus } from '@force-bridge/db/entity/BtcUnlock';

export class BtcDb implements IQuery {
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

  async getNotSuccessUnlockRecord(ckbTxHash: string): Promise<BtcUnlock[]> {
    const successStatus: BtcUnlockStatus = 'success';
    return await this.btcUnlockRepository.find({
      status: Not(successStatus),
      ckbTxHash: ckbTxHash,
    });
  }

  async getLockRecordByHash(btcLockHash: string): Promise<BtcLock[]> {
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

  async getLockRecordsByUser(userAddr: string): Promise<LockRecord[]> {
    return await this.connection.manager.query(
      `select btc.sender as sender, ckb.recipient_lockscript as recipient , btc.amount as lock_amount,ckb.amount as mint_amount,btc.txid as lock_hash FROM btc_lock btc join ckb_mint ckb on btc.txid = ckb.id where btc.sender = ?`,
      [userAddr],
    );
  }

  async getUnlockRecordsByUser(ckbLockScriptHash: string): Promise<UnlockRecord[]> {
    return await this.connection.manager.query(
      `select ckb.sender_lock_hash as sender, ckb.recipient_address as recipient , ckb.amount as burn_amount, btc.amount as unlock_amount,ckb.ckb_tx_hash as burn_hash,btc.btc_tx_hash as unlock_hash FROM btc_unlock btc join ckb_burn ckb on btc.ckb_tx_hash = ckb.ckb_tx_hash where btc.status = 'success' and ckb.sender_lock_hash = ?`,
      [ckbLockScriptHash],
    );
  }
}
