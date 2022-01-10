// invoke in eth handler
import { Connection, In, Repository, UpdateResult } from 'typeorm';
import { ForceBridgeCore } from '../core';
import { CollectorCkbMint } from './entity/CkbMint';
import { CollectorCkbUnlock } from './entity/CkbUnlock';
import { EthBurn } from './entity/EthBurn';
import { CollectorEthMint, EthMint } from './entity/EthMint';
import { CollectorEthUnlock, EthUnlockStatus } from './entity/EthUnlock';
import {
  CkbBurn,
  CkbMint,
  EthLock,
  EthUnlock,
  ICkbMint,
  ICkbUnlock,
  IEthBurn,
  IEthLock,
  IEthMint,
  IEthUnlock,
  IQuery,
  LockRecord,
  TxConfirmStatus,
  UnlockRecord,
} from './model';

export class EthDb implements IQuery {
  private ckbMintRepository: Repository<CkbMint>;
  private ethMintRepository: Repository<EthMint>;
  private ethLockRepository: Repository<EthLock>;
  private ethUnlockRepository: Repository<EthUnlock>;
  private collectorEthUnlockRepository: Repository<CollectorEthUnlock>;
  private collectorCkbMintRepository: Repository<CollectorCkbMint>;
  private collectorEthMintRepository: Repository<CollectorEthMint>;

  constructor(private connection: Connection) {
    this.ckbMintRepository = connection.getRepository(CkbMint);
    this.ethMintRepository = connection.getRepository(EthMint);
    this.ethLockRepository = connection.getRepository(EthLock);
    this.ethUnlockRepository = connection.getRepository(EthUnlock);
    this.collectorEthUnlockRepository = connection.getRepository(CollectorEthUnlock);
    this.collectorCkbMintRepository = connection.getRepository(CollectorCkbMint);
    this.collectorEthMintRepository = connection.getRepository(CollectorEthMint);
  }

  async getBurnRecord(logIndex: number, txHash: string): Promise<EthBurn | undefined> {
    return this.connection.getRepository(EthBurn).findOne(EthBurn.primaryKey(logIndex, txHash));
  }

  async todoMintRecords(number = 100): Promise<CollectorEthMint[]> {
    const records = await this.collectorEthMintRepository.find({
      where: {
        status: 'todo',
      },
      order: {
        createdAt: 'ASC',
      },
      take: number,
    });

    if (records.length <= 0) {
      return records;
    }

    const mintedRecord = await this.ethMintRepository.findByIds(records.map((r) => r.ckbTxHash));

    const mintedIds = await this.succeedMint(mintedRecord);

    return records.filter((r) => mintedIds.includes(r.ckbTxHash));
  }

  async succeedMint(records: EthMint[]): Promise<string[]> {
    const ids = records.map((r) => r.ckbTxHash);
    await this.collectorEthMintRepository.update(ids, { status: 'success' });

    return ids;
  }

  /**
   * @param records
   * @returns Make sure that no failed record is minted on the chain.
   */
  async makeMintPending(records: CollectorEthMint[]): Promise<CollectorEthMint[]> {
    const ids = records.map((r) => r.ckbTxHash);

    await this.collectorEthMintRepository.update(ids, { status: 'pending' });

    return await this.collectorEthMintRepository.findByIds(ids, {
      where: {
        status: 'pending',
      },
    });
  }

  async getCEthMintRecordByEthTx(tx: string): Promise<CollectorEthMint | undefined> {
    return await this.connection.getRepository(CollectorEthMint).findOne({ ethTxHash: tx });
  }

  async getCEthMintRecordByCkbTx(tx: string): Promise<CollectorEthMint | undefined> {
    return await this.connection.getRepository(CollectorEthMint).findOne({ ckbTxHash: tx });
  }

  async getEthMint(ckbTx: string): Promise<EthMint | undefined> {
    return await this.connection.getRepository(EthMint).findOne(ckbTx);
  }

  async saveEthMint(record: EthMint): Promise<EthMint> {
    return await this.connection.getRepository(EthMint).save(record);
  }

  async getLatestHeight(): Promise<number> {
    const rawRes = await this.connection.manager.query('select max(block_number) as max_block_number from eth_lock');
    return rawRes[0].max_block_number || ForceBridgeCore.config.eth.startBlockHeight;
  }

  async createCollectorCkbMint(records: ICkbMint[]): Promise<void> {
    const dbRecords = records.map((r) => this.collectorCkbMintRepository.create(r));
    await this.collectorCkbMintRepository.save(dbRecords);
  }

  async createCollectorCkbUnlock(records: ICkbUnlock[]): Promise<void> {
    await this.connection
      .getRepository(CollectorCkbUnlock)
      .save(records.map((r) => this.connection.getRepository(CollectorCkbUnlock).create(r)));
  }

  async createEthUnlock(records: IEthUnlock[]): Promise<void> {
    const ethUnlockRepo = this.connection.getRepository(EthUnlock);
    const dbRecords = records.map((r) => ethUnlockRepo.create(r));
    await ethUnlockRepo.save(dbRecords);
  }

  async saveCollectorEthUnlock(records: IEthUnlock[]): Promise<void> {
    await this.collectorEthUnlockRepository.save(records.map((r) => this.collectorEthUnlockRepository.create(r)));
  }

  async saveCollectorEthMint(records: IEthMint[]): Promise<void> {
    await this.connection.getRepository(CollectorEthMint).save(records);
  }

  async saveCollectorEthMints(records: IEthMint[]): Promise<CollectorEthMint[]> {
    return await this.connection.getRepository(CollectorEthMint).save(records);
  }

  async createEthLock(records: IEthLock[]): Promise<void> {
    const dbRecords = records.map((r) => this.ethLockRepository.create(r));
    await this.ethLockRepository.save(dbRecords);
  }

  async createEthBurn(record: IEthBurn): Promise<void> {
    await this.connection.getRepository(EthBurn).save(this.connection.getRepository(EthBurn).create(record));
  }

  async saveEthBurn(record: EthBurn): Promise<void> {
    await this.connection.getRepository(EthBurn).save(record);
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
