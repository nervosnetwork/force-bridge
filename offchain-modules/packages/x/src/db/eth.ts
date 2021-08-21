// invoke in eth handler
import { Connection, In, Repository, UpdateResult } from 'typeorm';
import { ForceBridgeCore } from '../core';
import { CollectorCkbMint } from './entity/CkbMint';
import { CollectorEthUnlock, EthUnlockStatus } from './entity/EthUnlock';
import {
  CkbBurn,
  CkbMint,
  EthLock,
  EthUnlock,
  ICkbMint,
  IEthLock,
  IEthUnlock,
  IQuery,
  LockRecord,
  TxConfirmStatus,
  UnlockRecord,
} from './model';

export class EthDb implements IQuery {
  private ckbMintRepository: Repository<CkbMint>;
  private ethLockRepository: Repository<EthLock>;
  private ethUnlockRepository: Repository<EthUnlock>;
  private collectorEthUnlockRepository: Repository<CollectorEthUnlock>;
  private collectorCkbMintRepository: Repository<CollectorCkbMint>;

  constructor(private connection: Connection) {
    this.ckbMintRepository = connection.getRepository(CkbMint);
    this.ethLockRepository = connection.getRepository(EthLock);
    this.ethUnlockRepository = connection.getRepository(EthUnlock);
    this.collectorEthUnlockRepository = connection.getRepository(CollectorEthUnlock);
    this.collectorCkbMintRepository = connection.getRepository(CollectorCkbMint);
  }

  async getLatestHeight(): Promise<number> {
    const rawRes = await this.connection.manager.query('select max(block_number) as max_block_number from eth_lock');
    return rawRes[0].max_block_number || ForceBridgeCore.config.eth.startBlockHeight;
  }

  async createCollectorCkbMint(records: ICkbMint[]): Promise<void> {
    const dbRecords = records.map((r) => this.collectorCkbMintRepository.create(r));
    await this.collectorCkbMintRepository.save(dbRecords);
  }

  async createEthUnlock(records: IEthUnlock[]): Promise<void> {
    const ethUnlockRepo = this.connection.getRepository(EthUnlock);
    const dbRecords = records.map((r) => ethUnlockRepo.create(r));
    await ethUnlockRepo.save(dbRecords);
  }

  async saveCollectorEthUnlock(records: IEthUnlock[]): Promise<void> {
    await this.collectorEthUnlockRepository.save(records.map((r) => this.collectorEthUnlockRepository.create(r)));
  }

  async createEthLock(records: IEthLock[]): Promise<void> {
    const dbRecords = records.map((r) => this.ethLockRepository.create(r));
    await this.ethLockRepository.save(dbRecords);
  }

  async updateCollectorUnlockStatus(ckbTxHash: string, blockNumber: number, status: EthUnlockStatus): Promise<void> {
    await this.connection
      .getRepository(CollectorEthUnlock)
      .createQueryBuilder()
      .update()
      .set({ blockNumber: blockNumber, status: status })
      .where({ ckbTxHash })
      .execute();
  }

  async updateLockConfirmNumber(
    records: { uniqueId: string; confirmedNumber: number; confirmStatus: TxConfirmStatus }[],
  ): Promise<UpdateResult[]> {
    const updataResults = new Array(0);
    for (const record of records) {
      const result = await this.ethLockRepository
        .createQueryBuilder()
        .update()
        .set({ confirmNumber: record.confirmedNumber, confirmStatus: record.confirmStatus })
        .where('unique_id = :uniqueId', { uniqueId: record.uniqueId })
        .execute();
      updataResults.push(result);
    }
    return updataResults;
  }

  async updateBridgeInRecord(
    uniqueId: string,
    amount: string,
    token: string,
    recipient: string,
    sudtExtraData: string,
  ): Promise<void> {
    const mintRecord = await this.connection
      .getRepository(CkbMint)
      .createQueryBuilder()
      .select()
      .where({ id: uniqueId })
      .getOne();
    if (mintRecord) {
      const bridgeFee = (BigInt(amount) - BigInt(mintRecord.amount)).toString();
      await this.updateLockBridgeFee(uniqueId, bridgeFee);
      await this.connection
        .getRepository(CkbMint)
        .createQueryBuilder()
        .update()
        .set({ asset: token, recipientLockscript: recipient, sudtExtraData: sudtExtraData })
        .where({ id: uniqueId })
        .execute();
    }
  }

  async updateLockBridgeFee(uniqueId: string, bridgeFee: string): Promise<void> {
    await this.ethLockRepository
      .createQueryBuilder()
      .update()
      .set({ bridgeFee: bridgeFee })
      .where({ uniqueId })
      .execute();
  }

  async updateBurnBridgeFee(burnTxHash: string, unlockAmount: string): Promise<void> {
    const query = await this.connection.getRepository(CkbBurn).createQueryBuilder();
    const row = await query.select().where('ckb_tx_hash = :ckbTxHash', { ckbTxHash: burnTxHash }).getOne();
    if (row) {
      const bridgeFee = (BigInt(row.amount) - BigInt(unlockAmount)).toString();
      await query
        .update()
        .set({ bridgeFee: bridgeFee })
        .where('ckb_tx_hash = :ckbTxHash', { ckbTxHash: burnTxHash })
        .execute();
    }
  }

  async getEthUnlockRecordsToUnlock(status: EthUnlockStatus, take = 10): Promise<EthUnlock[]> {
    return await this.collectorEthUnlockRepository.find({
      where: {
        status,
      },
      take,
    });
  }

  async getLockRecordsByCkbAddress(ckbRecipientAddr: string, XChainAsset: string): Promise<LockRecord[]> {
    return await this.ethLockRepository
      .createQueryBuilder('eth')
      .leftJoinAndSelect('ckb_mint', 'ckb', 'eth.unique_id = ckb.id')
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
        eth.token as asset,
        case when isnull(ckb.amount) then null else 'success' end as status,
        '' as message,
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
        ckb.asset as asset,
        case when isnull(eth.amount) then null else 'success' end as status,
        '' as message,
        ckb.bridge_fee as bridge_fee
      `,
      )
      .orderBy('ckb.updated_at', 'DESC')
      .getRawMany();
  }

  async getLockRecordsByXChainAddress(XChainSender: string, XChainAsset: string): Promise<LockRecord[]> {
    return await this.ethLockRepository
      .createQueryBuilder('eth')
      .leftJoinAndSelect('ckb_mint', 'ckb', 'eth.unique_id = ckb.id')
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
        eth.token as asset,
        case when isnull(ckb.amount) then null else 'success' end as status,
        '' as message,
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
        ckb.asset as asset,
        case when isnull(eth.amount) then null else 'success' end as status,
        '' as message,
        ckb.bridge_fee as bridge_fee
      `,
      )
      .orderBy('ckb.updated_at', 'DESC')
      .getRawMany();
  }

  async getEthLocksByUniqueIds(uniqueIds: string[]): Promise<EthLock[]> {
    return await this.connection.getRepository(EthLock).find({
      where: {
        uniqueId: In(uniqueIds),
      },
    });
  }

  async getEthUnlockByCkbTxHashes(ckbTxHashes: string[]): Promise<EthUnlock[]> {
    return await this.connection.getRepository(EthUnlock).find({
      where: {
        ckbTxHash: In(ckbTxHashes),
      },
    });
  }

  async setCollectorEthUnlockToSuccess(ckbTxHashes: string[]): Promise<void> {
    await this.connection
      .getRepository(CollectorEthUnlock)
      .createQueryBuilder()
      .update()
      .set({ status: 'success' })
      .where({ ckbTxHash: In(ckbTxHashes) })
      .execute();
  }
}
