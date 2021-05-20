// invoke in BTC handler
import {
  BtcLock,
  BtcUnlock,
  CkbBurn,
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
import { ForceBridgeCore } from '@force-bridge/core';

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
    return rawRes[0].max_block_number || ForceBridgeCore.config.btc.startBlockHeight;
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

  async getLockRecordsByCkbAddress(ckbRecipientAddr: string, XChainAsset: string): Promise<LockRecord[]> {
    return await this.connection
      .getRepository(CkbMint)
      .createQueryBuilder('ckb')
      .innerJoinAndSelect('btc_lock', 'btc', 'btc.txid = ckb.id')
      .where('ckb.recipient_lockscript = :recipient  AND ckb.asset = :asset', {
        recipient: ckbRecipientAddr,
        asset: XChainAsset,
      })
      .select(
        `
        btc.sender as sender,
        ckb.recipient_lockscript as recipient,
        btc.amount as lock_amount,
        ckb.amount as mint_amount,
        btc.txid as lock_hash,
        ckb.mint_hash as mint_hash,
        btc.updated_at as lock_time, 
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
    return await this.connection
      .getRepository(CkbBurn)
      .createQueryBuilder('ckb')
      .innerJoinAndSelect('btc_unlock', 'btc', 'btc.ckb_tx_hash = ckb.ckb_tx_hash')
      .where('ckb.sender_lock_hash = :sender_lock_hash AND ckb.asset = :asset', {
        sender_lock_hash: ckbLockScriptHash,
        asset: XChainAsset,
      })

      .select(
        `
        ckb.sender_lock_hash as sender, 
        btc.recipient_address as recipient , 
        ckb.amount as burn_amount, 
        btc.amount as unlock_amount,
        ckb.ckb_tx_hash as burn_hash,
        btc.btc_tx_hash as unlock_hash,
        btc.updated_at as unlock_time, 
        ckb.updated_at as burn_time, 
        btc.status as status,
        ckb.asset as asset,
        btc.message as message
      `,
      )
      .orderBy('ckb.updated_at', 'DESC')
      .getRawMany();
  }

  async getLockRecordsByXChainAddress(XChainSender: string, XChainAsset: string): Promise<LockRecord[]> {
    return await this.connection
      .getRepository(CkbMint)
      .createQueryBuilder('ckb')
      .innerJoinAndSelect('btc_lock', 'btc', 'btc.txid = ckb.id')
      .where('btc.sender = :sender AND ckb.asset = :asset', { sender: XChainSender, asset: XChainAsset })
      .select(
        `
        btc.sender as sender,
        ckb.recipient_lockscript as recipient,
        btc.amount as lock_amount,
        ckb.amount as mint_amount,
        btc.txid as lock_hash,
        ckb.mint_hash as mint_hash,
        btc.updated_at as lock_time, 
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
    return await this.connection
      .getRepository(CkbBurn)
      .createQueryBuilder('ckb')
      .innerJoinAndSelect('btc_unlock', 'btc', 'btc.ckb_tx_hash = ckb.ckb_tx_hash')
      .where('ckb.recipient_address = :recipient_address AND ckb.asset = :asset', {
        recipient_address: XChainRecipientAddr,
        asset: XChainAsset,
      })
      .select(
        `
        ckb.sender_lock_hash as sender, 
        btc.recipient_address as recipient , 
        ckb.amount as burn_amount, 
        btc.amount as unlock_amount,
        ckb.ckb_tx_hash as burn_hash,
        btc.btc_tx_hash as unlock_hash,
        btc.updated_at as unlock_time, 
        ckb.updated_at as burn_time, 
        btc.status as status,
        ckb.asset as asset,
        btc.message as message
      `,
      )
      .orderBy('ckb.updated_at', 'DESC')
      .getRawMany();
  }
}
