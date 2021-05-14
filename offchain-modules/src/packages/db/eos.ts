// invoke in eos handler

import { Connection, Repository } from 'typeorm';
import {
  CkbMint,
  EosUnlock,
  EosLock,
  ICkbMint,
  IEosLock,
  IQuery,
  LockRecord,
  UnlockRecord,
  CkbBurn,
} from '@force-bridge/db/model';
import { EosUnlockStatus } from '@force-bridge/db/entity/EosUnlock';

export class EosDb implements IQuery {
  private ckbMintRepository: Repository<CkbMint>;
  private eosLockRepository: Repository<EosLock>;
  private eosUnlockRepository: Repository<EosUnlock>;

  constructor(private conn: Connection) {
    this.ckbMintRepository = conn.getRepository(CkbMint);
    this.eosLockRepository = conn.getRepository(EosLock);
    this.eosUnlockRepository = conn.getRepository(EosUnlock);
  }

  async getLastedGlobalActionSeq(): Promise<number> {
    const rawRes = await this.conn.manager.query('select max(global_action_Seq) as lasted_global_seq from eos_lock');
    return rawRes[0].lasted_global_seq || -1;
  }

  async getActionPos(globalActionSeq: number): Promise<number> {
    const rawRes = await this.conn.manager.query(
      'select action_pos from eos_lock where global_action_Seq = ' + globalActionSeq,
    );
    return rawRes.length === 0 ? 0 : rawRes[0].action_pos;
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

  async getLockRecordsByCkbAddress(ckbRecipientAddr: string, XChainAsset: string): Promise<LockRecord[]> {
    return await this.conn
      .getRepository(CkbMint)
      .createQueryBuilder('ckb')
      .innerJoinAndSelect('eos_lock', 'eos', 'eos.id = ckb.id')
      .where('ckb.recipient_lockscript = :recipient AND ckb.asset = :asset', {
        recipient: ckbRecipientAddr,
        asset: XChainAsset,
      })
      .select(
        `
        eos.sender as sender, 
        ckb.recipient_lockscript as recipient , 
        eos.amount as lock_amount,
        ckb.amount as mint_amount,
        eos.id as lock_hash,
        ckb.mint_hash as mint_hash,
        eos.updated_at as lock_time, 
        ckb.updated_at as mint_time, 
        ckb.status as status,
        ckb.asset as asset,
        ckb.message as message
      `,
      )
      .orderBy('ckb.updated_at', 'DESC')
      .getRawMany();
  }

  async getUnlockRecordsByCkbAddress(ckbLockScriptHash: string, XChainAsset: string): Promise<UnlockRecord[]> {
    return await this.conn
      .getRepository(CkbBurn)
      .createQueryBuilder('ckb')
      .innerJoinAndSelect('eos_unlock', 'eos', 'eos.ckb_tx_hash = ckb.ckb_tx_hash')
      .where('ckb.sender_lock_hash = :sender_lock_hash AND ckb.asset = :asset', {
        sender_lock_hash: ckbLockScriptHash,
        asset: XChainAsset,
      })
      .select(
        `
        ckb.sender_lock_hash as sender, 
        eos.recipient_address as recipient ,
        ckb.amount as burn_amount, 
        eos.amount as unlock_amount,
        ckb.ckb_tx_hash as burn_hash,
        eos.eos_tx_hash as unlock_hash,
        eos.updated_at as unlock_time, 
        ckb.updated_at as burn_time, 
        eos.status as status,
        ckb.asset as asset,
        eos.message as message
      `,
      )
      .orderBy('ckb.updated_at', 'DESC')
      .getRawMany();
  }

  async getLockRecordsByXChainAddress(XChainSender: string, XChainAsset: string): Promise<LockRecord[]> {
    return await this.conn
      .getRepository(CkbMint)
      .createQueryBuilder('ckb')
      .innerJoinAndSelect('eos_lock', 'eos', 'eos.id = ckb.id')
      .where('eos.sender = :sender AND ckb.asset = :asset', { sender: XChainSender, asset: XChainAsset })
      .select(
        `
        eos.sender as sender, 
        ckb.recipient_lockscript as recipient , 
        eos.amount as lock_amount,
        ckb.amount as mint_amount,
        eos.id as lock_hash,
        ckb.mint_hash as mint_hash,
        eos.updated_at as lock_time, 
        ckb.updated_at as mint_time, 
        ckb.status as status,
        ckb.asset as asset,
        ckb.message as message
      `,
      )
      .orderBy('ckb.updated_at', 'DESC')
      .getRawMany();
  }

  async getUnlockRecordsByXChainAddress(XChainRecipientAddr: string, XChainAsset: string): Promise<UnlockRecord[]> {
    return await this.conn
      .getRepository(CkbBurn)
      .createQueryBuilder('ckb')
      .innerJoinAndSelect('eos_unlock', 'eos', 'eos.ckb_tx_hash = ckb.ckb_tx_hash')
      .where('ckb.recipient_address = :recipient_address AND ckb.asset = :asset', {
        recipient_address: XChainRecipientAddr,
        asset: XChainAsset,
      })
      .select(
        `
        ckb.sender_lock_hash as sender, 
        eos.recipient_address as recipient ,
        ckb.amount as burn_amount, 
        eos.amount as unlock_amount,
        ckb.ckb_tx_hash as burn_hash,
        eos.eos_tx_hash as unlock_hash,
        eos.updated_at as unlock_time, 
        ckb.updated_at as burn_time, 
        eos.status as status,
        ckb.asset as asset,
        eos.message as message
      `,
      )
      .orderBy('ckb.updated_at', 'DESC')
      .getRawMany();
  }
}
