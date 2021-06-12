// invoke in eth handler
import { Amount } from '@lay2/pw-core';
import { Connection, DeleteResult, In, Repository, UpdateResult } from 'typeorm';
import { ForceBridgeCore } from '../core';
import { EthUnlockStatus } from './entity/EthUnlock';
import { CkbBurn, CkbMint, EthLock, EthUnlock, ICkbMint, IEthLock, IQuery, LockRecord, UnlockRecord } from './model';

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

  async removeUnconfirmedLocks(confirmedBlockHeight: number): Promise<DeleteResult> {
    return this.ethLockRepository
      .createQueryBuilder()
      .delete()
      .where('block_number > :blockNumber And confirm_status = "unconfirmed"', { blockNumber: confirmedBlockHeight })
      .execute();
  }

  async getUnconfirmedLocks(limit = 1000): Promise<EthLock[]> {
    return this.ethLockRepository
      .createQueryBuilder()
      .select()
      .where('confirm_status = "unconfirmed"')
      .limit(limit)
      .getMany();
  }

  async updateLockConfirmStatus(txHashes: string[]): Promise<UpdateResult> {
    return this.ethLockRepository
      .createQueryBuilder()
      .update()
      .set({ confirmStatus: 'confirmed' })
      .where({ txHash: In(txHashes) })
      .execute();
  }

  async updateLockConfirmNumber(records: { txHash: string; confirmedNumber: number }[]): Promise<UpdateResult[]> {
    const updataResults = new Array(0);
    for (const record of records) {
      const result = await this.ethLockRepository
        .createQueryBuilder()
        .update()
        .set({ confirmNumber: record.confirmedNumber })
        .where('tx_hash = :txHash', { txHash: record.txHash })
        .execute();
      updataResults.push(result);
    }
    return updataResults;
  }

  async updateBurnBridgeFee(burnTxHash: string, unlockAmount: string) {
    const query = this.connection.getRepository(CkbBurn).createQueryBuilder();
    const row = await query.select().where('ckbTxHash = :ckbTxHash', { ckbTxHash: burnTxHash }).getOneOrFail();
    const bridgeFee = new Amount(row.amount, 0).sub(new Amount(unlockAmount, 0)).toString(0);
    await query
      .update()
      .set({ bridgeFee: bridgeFee })
      .where('ckbTxHash = :ckbTxHash', { ckbTxHash: burnTxHash })
      .execute();
  }

  async watcherUpdateUnlock(burnTxHash: string, unlockTxHash: string, unlockAmount: string) {
    await this.connection
      .getRepository(EthUnlock)
      .createQueryBuilder()
      .update()
      .set({ status: 'success', ethTxHash: unlockTxHash, amount: unlockAmount })
      .where('ckbTxHash = :ckbTxHash', { ckbTxHash: burnTxHash })
      .execute();
  }

  async getEthUnlockRecordsToUnlock(status: EthUnlockStatus, take = 100): Promise<EthUnlock[]> {
    return this.ethUnlockRepository.find({
      where: {
        status,
      },
      take,
    });
  }

  async getLockRecordsByCkbAddress(ckbRecipientAddr: string, XChainAsset: string): Promise<LockRecord[]> {
    return await this.ethLockRepository
      .createQueryBuilder('eth')
      .leftJoinAndSelect('ckb_mint', 'ckb', 'eth.tx_hash = ckb.id')
      .where('eth.recipient = :recipient AND eth.token = :asset', {
        recipient: ckbRecipientAddr,
        asset: XChainAsset,
      })
      .select(
        `
        eth.sender as sender, 
        eth.recipient as recipient, 
        eth.amount as lock_amount,
        ckb.amount as mint_amount,
        eth.tx_hash as lock_hash,
        ckb.mint_hash as mint_hash,
        eth.updated_at as lock_time, 
        eth.confirm_number as lock_confirm_number,
        eth.confirm_status as lock_confirm_status,
        ckb.updated_at as mint_time, 
        ckb.status as status,
        eth.token as asset,
        ckb.message as message,
        eth.bridge_fee as bridge_fee
      `,
      )
      .orderBy('ckb.updated_at', 'DESC')
      .getRawMany();
  }

  async getUnlockRecordsByCkbAddress(ckbAddress: string, XChainAsset: string): Promise<UnlockRecord[]> {
    return await this.connection
      .getRepository(CkbBurn)
      .createQueryBuilder('ckb')
      .leftJoinAndSelect('eth_unlock', 'eth', 'eth.ckb_tx_hash = ckb.ckb_tx_hash')
      .where('ckb.sender_address = :sender_address AND ckb.asset = :asset', {
        sender_address: ckbAddress,
        asset: XChainAsset,
      })
      .select(
        `
        ckb.sender_address as sender, 
        ckb.recipient_address as recipient , 
        ckb.amount as burn_amount, 
        eth.amount as unlock_amount,
        ckb.ckb_tx_hash as burn_hash,
        eth.eth_tx_hash as unlock_hash,
        eth.updated_at as unlock_time, 
        ckb.updated_at as burn_time, 
        ckb.confirm_number as burn_confirm_number,
        ckb.confirm_status as burn_confirm_status,
        eth.status as status,
        ckb.asset as asset,
        eth.message as message,
        ckb.bridge_fee as bridge_fee
      `,
      )
      .orderBy('ckb.updated_at', 'DESC')
      .getRawMany();
  }

  async getLockRecordsByXChainAddress(XChainSender: string, XChainAsset: string): Promise<LockRecord[]> {
    return await this.ethLockRepository
      .createQueryBuilder('eth')
      .leftJoinAndSelect('ckb_mint', 'ckb', 'eth.tx_hash = ckb.id')
      .where('eth.sender = :sender AND eth.token = :asset', { sender: XChainSender, asset: XChainAsset })
      .select(
        `
        eth.sender as sender, 
        eth.recipient as recipient, 
        eth.amount as lock_amount,
        ckb.amount as mint_amount,
        eth.tx_hash as lock_hash,
        ckb.mint_hash as mint_hash,
        eth.updated_at as lock_time, 
        eth.confirm_number as lock_confirm_number,
        eth.confirm_status as lock_confirm_status,
        ckb.updated_at as mint_time, 
        ckb.status as status,
        eth.token as asset,
        ckb.message as message,
        eth.bridge_fee as bridge_fee
      `,
      )
      .orderBy('ckb.updated_at', 'DESC')
      .getRawMany();
  }

  async getUnlockRecordsByXChainAddress(XChainRecipientAddr: string, XChainAsset: string): Promise<UnlockRecord[]> {
    return await this.connection
      .getRepository(CkbBurn)
      .createQueryBuilder('ckb')
      .leftJoinAndSelect('eth_unlock', 'eth', 'eth.ckb_tx_hash = ckb.ckb_tx_hash')
      .where('ckb.recipient_address = :recipient_address AND ckb.asset = :asset', {
        recipient_address: XChainRecipientAddr,
        asset: XChainAsset,
      })
      .select(
        `
        ckb.sender_address as sender, 
        ckb.recipient_address as recipient , 
        ckb.amount as burn_amount, 
        eth.amount as unlock_amount,
        ckb.ckb_tx_hash as burn_hash,
        eth.eth_tx_hash as unlock_hash,
        eth.updated_at as unlock_time, 
        ckb.updated_at as burn_time, 
        ckb.confirm_number as burn_confirm_number,
        ckb.confirm_status as burn_confirm_status,
        eth.status as status,
        ckb.asset as asset,
        eth.message as message,
        ckb.bridge_fee as bridge_fee
      `,
      )
      .orderBy('ckb.updated_at', 'DESC')
      .getRawMany();
  }

  async getEthLocksByTxHashes(txHashes: string[]): Promise<EthLock[]> {
    return this.connection.getRepository(EthLock).find({
      where: {
        txHash: In(txHashes),
      },
    });
  }
}
