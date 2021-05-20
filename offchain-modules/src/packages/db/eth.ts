// invoke in eth handler
import {
  CkbBurn,
  CkbMint,
  EthLock,
  EthUnlock,
  ICkbMint,
  IEthLock,
  IQuery,
  LockRecord,
  UnlockRecord,
} from '@force-bridge/db/model';
import { Connection, Repository } from 'typeorm';
import { EthUnlockStatus } from '@force-bridge/db/entity/EthUnlock';
import { ForceBridgeCore } from '@force-bridge/core';

export class EthDb implements IQuery {
  private ckbMintRepository: Repository<CkbMint>;
  private ethLockRepository: Repository<EthLock>;
  private ethUnlockRepository: Repository<EthUnlock>;

  constructor(private connection: Connection) {
    this.ckbMintRepository = connection.getRepository(CkbMint);
    this.ethLockRepository = connection.getRepository(EthLock);
    this.ethUnlockRepository = connection.getRepository(EthUnlock);
  }

  async getLatestHeight(): Promise<number> {
    const rawRes = await this.connection.manager.query('select max(block_number) as max_block_number from eth_lock');
    return rawRes[0].max_block_number || ForceBridgeCore.config.eth.startBlockHeight;
  }

  async createCkbMint(records: ICkbMint[]): Promise<void> {
    const dbRecords = records.map((r) => this.ckbMintRepository.create(r));
    await this.ckbMintRepository.save(dbRecords);
  }

  async saveEthUnlock(records: EthUnlock[]): Promise<void> {
    await this.ethUnlockRepository.save(records);
  }

  async createEthLock(records: IEthLock[]): Promise<void> {
    const dbRecords = records.map((r) => this.ethLockRepository.create(r));
    await this.ethLockRepository.save(dbRecords);
  }

  async getEthUnlockRecordsToUnlock(status: EthUnlockStatus, take = 1): Promise<EthUnlock[]> {
    return this.ethUnlockRepository.find({
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
      .innerJoinAndSelect('eth_lock', 'eth', 'eth.tx_hash = ckb.id')
      .where('ckb.recipient_lockscript = :recipient AND ckb.asset = :asset', {
        recipient: ckbRecipientAddr,
        asset: XChainAsset,
      })
      .select(
        `
        eth.sender as sender, 
        ckb.recipient_lockscript as recipient, 
        eth.amount as lock_amount,
        ckb.amount as mint_amount,
        eth.tx_hash as lock_hash,
        ckb.mint_hash as mint_hash,
        eth.updated_at as lock_time, 
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
      .innerJoinAndSelect('eth_unlock', 'eth', 'eth.ckb_tx_hash = ckb.ckb_tx_hash')
      .where('ckb.sender_lock_hash = :sender_lock_hash AND ckb.asset = :asset', {
        sender_lock_hash: ckbLockScriptHash,
        asset: XChainAsset,
      })
      .select(
        `
        ckb.sender_lock_hash as sender, 
        ckb.recipient_address as recipient , 
        ckb.amount as burn_amount, 
        eth.amount as unlock_amount,
        ckb.ckb_tx_hash as burn_hash,
        eth.eth_tx_hash as unlock_hash,
        eth.updated_at as unlock_time, 
        ckb.updated_at as burn_time, 
        eth.status as status,
        ckb.asset as asset,
        eth.message as message 
      `,
      )
      .orderBy('ckb.updated_at', 'DESC')
      .getRawMany();
  }

  async getLockRecordsByXChainAddress(XChainSender: string, XChainAsset: string): Promise<LockRecord[]> {
    return await this.connection
      .getRepository(CkbMint)
      .createQueryBuilder('ckb')
      .innerJoinAndSelect('eth_lock', 'eth', 'eth.tx_hash = ckb.id')
      .where('eth.sender = :sender AND ckb.asset = :asset', { sender: XChainSender, asset: XChainAsset })
      .select(
        `
        eth.sender as sender, 
        ckb.recipient_lockscript as recipient, 
        eth.amount as lock_amount,
        ckb.amount as mint_amount,
        eth.tx_hash as lock_hash,
        ckb.mint_hash as mint_hash,
        eth.updated_at as lock_time, 
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
      .innerJoinAndSelect('eth_unlock', 'eth', 'eth.ckb_tx_hash = ckb.ckb_tx_hash')
      .where('ckb.recipient_address = :recipient_address AND ckb.asset = :asset', {
        recipient_address: XChainRecipientAddr,
        asset: XChainAsset,
      })
      .select(
        `
        ckb.sender_lock_hash as sender, 
        ckb.recipient_address as recipient , 
        ckb.amount as burn_amount, 
        eth.amount as unlock_amount,
        ckb.ckb_tx_hash as burn_hash,
        eth.eth_tx_hash as unlock_hash,
        eth.updated_at as unlock_time, 
        ckb.updated_at as burn_time, 
        eth.status as status,
        ckb.asset as asset,
        eth.message as message 
      `,
      )
      .orderBy('ckb.updated_at', 'DESC')
      .getRawMany();
  }
}
