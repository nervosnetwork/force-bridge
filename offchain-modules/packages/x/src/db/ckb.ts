// invoke in ckb handler
import { Connection, In, UpdateResult } from 'typeorm';
import { ChainType } from '../ckb/model/asset';
import { ForceBridgeCore } from '../core';
import { CollectorCkbMint, dbTxStatus } from './entity/CkbMint';
import { CkbUnlockStatus, CollectorCkbUnlock } from './entity/CkbUnlock';
import { EthBurn } from './entity/EthBurn';
import { CollectorEthMint, EthMint } from './entity/EthMint';
import { CollectorEthUnlock } from './entity/EthUnlock';
import {
  BtcUnlock,
  CkbBurn,
  CkbMint,
  CkbLock,
  CkbUnlock,
  EosUnlock,
  EthLock,
  EthUnlock,
  IBtcUnLock,
  ICkbBurn,
  ICkbMint,
  IEosUnlock,
  IEthUnlock,
  ITronUnlock,
  MintedRecords,
  TronUnlock,
  TxConfirmStatus,
  ICkbLock,
  IEthMint,
  ICkbUnlock,
  IQuery,
  LockRecord,
  UnlockRecord,
} from './model';

export class CkbDb implements IQuery {
  constructor(private connection: Connection) {}
  async getLockRecordsByCkbAddress(ckbSenderAddress: string, ckbAsset: string): Promise<LockRecord[]> {
    return await this.connection
      .getRepository(CkbLock)
      .createQueryBuilder('ckb')
      .leftJoinAndSelect('eth_mint', 'eth', 'ckb.ckb_tx_hash = eth.ckb_tx_hash')
      .where('ckb.sender_address = :sender AND ckb.asset_ident = :asset', {
        sender: ckbSenderAddress,
        asset: ckbAsset,
      })
      .select(
        `
        ckb.sender_address as sender,
        ckb.recipient_address as recipient,
        ckb.amount as lock_amount,
        eth.amount as mint_amount,
        ckb.ckb_tx_hash as lock_hash,
        eth.eth_tx_hash as mint_hash,
        ckb.updated_at as lock_time,
        ckb.confirm_number as lock_confirm_number,
        ckb.confirm_status as lock_confirm_status,
        eth.updated_at as mint_time,
        ckb.asset_ident as asset,
        eth.erc20_token_address as mint_asset,
        case when isnull(eth.amount) then null else 'success' end as status,
        '' as message,
        ckb.bridge_fee as bridge_fee
        `,
      )
      .orderBy('eth.updated_at', 'DESC')
      .getRawMany();
  }

  async getUnlockRecordsByCkbAddress(ckbRecipientAddress: string, xchainToken: string): Promise<UnlockRecord[]> {
    return await this.connection
      .getRepository(EthBurn)
      .createQueryBuilder('eth')
      .leftJoinAndSelect('ckb_unlock', 'ckb', 'ckb.id = eth.unique_id')
      .where('eth.recipient = :recipient AND eth.xchain_token_id = :token', {
        recipient: ckbRecipientAddress,
        token: xchainToken,
      })
      .select(
        `
        eth.sender as sender,
        eth.recipient as recipient,
        eth.amount as burn_amount,
        ckb.amount as unlock_amount,
        eth.burn_tx_hash as burn_hash,
        ckb.unlock_tx_hash as unlock_hash,
        ckb.updated_at as unlock_time,
        eth.updated_at as burn_time,
        eth.confirm_number as burn_confirm_number,
        eth.confirm_status as burn_confirm_status,
        eth.xchain_token_id as asset,
        ckb.asset_ident as unlock_asset,
        case when isnull(ckb.amount) then null else 'success' end as status,
        '' as message,
        eth.bridge_fee as bridge_fee
        `,
      )
      .orderBy('eth.updated_at', 'DESC')
      .getRawMany();
  }

  async getLockRecordsByXChainAddress(xchainRecipientAddress: string, ckbAsset: string): Promise<LockRecord[]> {
    return await this.connection
      .getRepository(CkbLock)
      .createQueryBuilder('ckb')
      .leftJoinAndSelect('eth_mint', 'eth', 'ckb.ckb_tx_hash=eth.ckb_tx_hash')
      .where('ckb.recipient_address=:recipient AND ckb.asset_ident=:asset', {
        recipient: xchainRecipientAddress,
        asset: ckbAsset,
      })
      .select(
        `
        ckb.sender_address as sender,
        ckb.recipient_address as recipient,
        ckb.amount as lock_amount,
        eth.amount as mint_amount,
        ckb.ckb_tx_hash as lock_hash,
        eth.eth_tx_hash as mint_hash,
        ckb.updated_at as lock_time,
        eth.updated_at as mint_time,
        ckb.confirm_number as lock_confirm_number,
        ckb.confirm_status as mint_confirm_status,
        ckb.asset_ident as asset,
        eth.erc20_token_address as mint_asset,
        case when isnull(eth.amount) then null else 'success' end as status,
        ckb.bridge_fee as bridge_fee
        `,
      )
      .orderBy('eth.updated_at', 'DESC')
      .getRawMany();
  }

  async getUnlockRecordsByXChainAddress(xchainSenderAddress: string, xchainToken: string): Promise<UnlockRecord[]> {
    return await this.connection
      .getRepository(EthBurn)
      .createQueryBuilder('eth')
      .leftJoinAndSelect('ckb_unlock', 'ckb', 'ckb.id=eth.unique_id')
      .where('eth.sender=:sender AND eth.xchain_token_id=:token', {
        sender: xchainSenderAddress,
        token: xchainToken,
      })
      .select(
        `
        eth.sender as sender,
        eth.recipient as recipient,
        eth.amount as burn_amount,
        ckb.amount as unlock_amount,
        eth.burn_tx_hash as burn_hash,
        ckb.unlock_tx_hash as unlock_hash,
        ckb.updated_at as unlock_time,
        eth.updated_at as burn_time,
        eth.confirm_number as burn_confirm_number,
        eth.confirm_status as burn_confirm_status,
        eth.xchain_token_id as asset,
        ckb.asset_ident as unlock_asset,
        case when isnull(ckb.amount) then null else 'success' end as status,
        '' as message,
        eth.bridge_fee as bridge_fee
        `,
      )
      .orderBy('eth.updated_at', 'DESC')
      .getRawMany();
  }

  // invoke when getting new burn events
  async saveCkbBurn(records: ICkbBurn[]): Promise<void> {
    await this.connection.manager.save(records);
  }

  async getCkbLatestHeight(): Promise<number> {
    const rawRes = await this.connection.manager.query('select max(block_number) as max_block_number from ckb_burn');
    return rawRes[0].max_block_number || ForceBridgeCore.config.ckb.startBlockHeight;
  }

  async getCkbMintRecordsToMint(status: dbTxStatus, take = 100): Promise<CollectorCkbMint[]> {
    return await this.connection.getRepository(CollectorCkbMint).find({
      where: {
        status: status,
      },
      order: {
        createdAt: 'ASC',
      },
      take,
    });
  }

  // update mint status
  async updateCollectorCkbMint(records: ICkbMint[]): Promise<void> {
    const mintRepo = this.connection.getRepository(CollectorCkbMint);
    await mintRepo.save(
      records.map((record) => {
        return mintRepo.create(record);
      }),
    );
  }

  async watcherCreateMint(blockNumber: number, mints: MintedRecords): Promise<void> {
    const dbRecords = mints.records.map((r) => {
      const mint: ICkbMint = {
        id: r.id,
        chain: ChainType.ETH,
        amount: r.amount.toString(),
        sudtExtraData: '',
        asset: '',
        recipientLockscript: '',
        blockNumber: blockNumber,
        mintHash: mints.txHash,
      };
      return this.connection.getRepository(CkbMint).create(mint);
    });
    await this.connection.getRepository(CkbMint).save(dbRecords);
  }

  async updateBridgeInRecords(mintedRecords: MintedRecords): Promise<void> {
    const lockQuery = this.connection.getRepository(EthLock).createQueryBuilder();
    const mintQuery = this.connection.getRepository(CkbMint).createQueryBuilder();
    for (const record of mintedRecords.records) {
      const row = await lockQuery.select().where('unique_id = :uniqueId', { uniqueId: record.id }).getOne();
      if (row) {
        const bridgeFee = (BigInt(row.amount) - BigInt(record.amount)).toString();
        await lockQuery.update().set({ bridgeFee: bridgeFee }).where({ uniqueId: record.id }).execute();
        await mintQuery
          .update()
          .set({ asset: row.token, recipientLockscript: row.recipient, sudtExtraData: row.sudtExtraData })
          .where({ id: record.id })
          .execute();
      }
    }
  }

  async updateBurnBridgeFee(records: ICkbBurn[]): Promise<void> {
    const unlockQuery = this.connection.getRepository(EthUnlock).createQueryBuilder();
    const burnQuery = this.connection.getRepository(CkbBurn).createQueryBuilder();
    for (const burn of records) {
      const unlockRecord = await unlockQuery
        .select()
        .where('ckb_tx_hash = :ckbTxHash', { ckbTxHash: burn.ckbTxHash })
        .getOne();
      if (unlockRecord) {
        const bridgeFee = (BigInt(burn.amount) - BigInt(unlockRecord.amount)).toString();
        await burnQuery
          .update()
          .set({ bridgeFee: bridgeFee })
          .where('ckb_tx_hash = :burnTxHash', { burnTxHash: burn.ckbTxHash })
          .execute();
      }
    }
  }

  async setCollectorCkbMintToSuccess(ids: string[]): Promise<void> {
    await this.connection
      .getRepository(CollectorCkbMint)
      .createQueryBuilder()
      .update()
      .set({ status: 'success' })
      .where({ id: In(ids) })
      .execute();
  }

  async updateCollectorCkbMintStatus(blockNumber: number, mintTxHash: string, status: dbTxStatus): Promise<void> {
    await this.connection
      .getRepository(CollectorCkbMint)
      .createQueryBuilder()
      .update()
      .set({ blockNumber: blockNumber, status: status })
      .where('mintHash = :mintTxHash', { mintTxHash: mintTxHash })
      .execute();
  }

  async updateCollectorCkbUnlockStatus(blockNumber: number, unlockHash: string, status: dbTxStatus): Promise<void> {
    await this.connection
      .getRepository(CollectorCkbUnlock)
      .createQueryBuilder()
      .update()
      .set({ blockNumber: blockNumber, status: status })
      .where('unlock_hash = :unlockHash', { unlockHash: unlockHash })
      .execute();
  }

  async createCkbBurn(records: ICkbBurn[]): Promise<void> {
    const ckbBurnRepo = this.connection.getRepository(CkbBurn);
    const dbRecords = records.map((r) => ckbBurnRepo.create(r));
    await ckbBurnRepo.save(dbRecords);
  }

  /* save chain specific data */
  async createCollectorEthUnlock(records: IEthUnlock[]): Promise<void> {
    const ethUnlockRepo = this.connection.getRepository(CollectorEthUnlock);
    const dbRecords = records.map((r) => ethUnlockRepo.create(r));
    await ethUnlockRepo.save(dbRecords);
  }

  async createEosUnlock(records: IEosUnlock[]): Promise<void> {
    const eosUnlockRepo = await this.connection.getRepository(EosUnlock);
    const dbRecords = records.map((r) => eosUnlockRepo.create(r));
    await eosUnlockRepo.save(dbRecords);
  }

  async createTronUnlock(records: ITronUnlock[]): Promise<void> {
    const tronUnlockRepo = await this.connection.getRepository(TronUnlock);
    const dbRecords = records.map((r) => tronUnlockRepo.create(r));
    await tronUnlockRepo.save(dbRecords);
  }

  async createBtcUnlock(records: IBtcUnLock[]): Promise<void> {
    const btcUnlockRepo = await this.connection.getRepository(BtcUnlock);
    const dbRecords = records.map((r) => btcUnlockRepo.create(r));
    await btcUnlockRepo.save(dbRecords);
  }

  async updateBurnConfirmNumber(
    records: { txHash: string; confirmedNumber: number; confirmStatus: TxConfirmStatus }[],
  ): Promise<UpdateResult[]> {
    const updataResults = new Array(0);
    for (const record of records) {
      const result = await this.connection
        .getRepository(CkbBurn)
        .createQueryBuilder()
        .update()
        .set({ confirmNumber: record.confirmedNumber, confirmStatus: record.confirmStatus })
        .where('ckb_tx_hash = :txHash', { txHash: record.txHash })
        .execute();
      updataResults.push(result);
    }
    return updataResults;
  }

  async getCkbBurnByTxHashes(ckbTxHashes: string[]): Promise<ICkbBurn[]> {
    return await this.connection.getRepository(CkbBurn).find({
      where: {
        ckbTxHash: In(ckbTxHashes),
      },
    });
  }

  async getCkbMintByIds(ids: string[]): Promise<CkbMint[]> {
    return await this.connection.getRepository(CkbMint).find({
      where: {
        id: In(ids),
      },
    });
  }

  async getCkbUnlockByIds(ids: string[]): Promise<CkbUnlock[]> {
    return await this.connection.getRepository(CkbUnlock).find({
      where: {
        id: In(ids),
      },
    });
  }

  async getCkbLockByTxHashes(ckbTxHashes: string[]): Promise<CkbLock[]> {
    return await this.connection.getRepository(CkbLock).find({
      where: {
        ckbTxHash: In(ckbTxHashes),
      },
    });
  }

  async saveCollectorCkbUnlock(records: ICkbUnlock[]): Promise<void> {
    await this.connection
      .getRepository(CollectorCkbUnlock)
      .save(records.map((r) => this.connection.getRepository(CollectorCkbUnlock).create(r)));
  }

  async createCkbLock(records: ICkbLock[]): Promise<void> {
    const dbRecords = records.map((r) => this.connection.getRepository(CkbLock).create(r));
    await this.connection.getRepository(CkbLock).save(dbRecords);
  }

  async updateLockConfirmNumber(
    records: { ckbTxHash: string; confirmedNumber: number; confirmStatus: TxConfirmStatus }[],
  ): Promise<UpdateResult[]> {
    const updataResults = new Array(0);
    for (const record of records) {
      const result = await this.connection
        .getRepository(CkbLock)
        .createQueryBuilder()
        .update()
        .set({
          confirmNumber: record.confirmedNumber,
          confirmStatus: record.confirmStatus,
        })
        .where('ckb_tx_hash = :ckbTxHash', { ckbTxHash: record.ckbTxHash })
        .execute();
      updataResults.push(result);
    }
    return updataResults;
  }

  async updateLockAmountAndBridgeFee(
    records: { ckbTxHash: string; amount: string; bridgeFee: string }[],
  ): Promise<UpdateResult[]> {
    const updataResults = new Array(0);
    for (const record of records) {
      const result = await this.connection
        .getRepository(CkbLock)
        .createQueryBuilder()
        .update()
        .set({
          amount: record.amount,
          bridgeFee: record.bridgeFee,
        })
        .where('ckb_tx_hash = :ckbTxHash', { ckbTxHash: record.ckbTxHash })
        .execute();
      updataResults.push(result);
    }
    return updataResults;
  }

  async createCollectorEthMint(records: IEthMint[]): Promise<void> {
    const dbRecords = records.map((r) => this.connection.getRepository(CollectorEthMint).create(r));
    await this.connection.getRepository(CollectorEthMint).save(dbRecords);
  }

  async getCollectorCkbUnlockRecordsToUnlock(status: CkbUnlockStatus, take = 10): Promise<CollectorCkbUnlock[]> {
    return await this.connection.getRepository(CollectorCkbUnlock).find({
      where: {
        status,
      },
      take,
    });
  }

  async getCkbUnlockByBurnTxHashes(burnTxHashes: string[]): Promise<CkbUnlock[]> {
    return await this.connection.getRepository(CkbUnlock).find({
      where: {
        burnTxHash: In(burnTxHashes),
      },
    });
  }

  async setCollectorCkbUnlockToSuccess(burnTxHashes: string[]): Promise<void> {
    await this.connection
      .getRepository(CollectorCkbUnlock)
      .createQueryBuilder()
      .update()
      .set({ status: 'success' })
      .where({ burnTxHash: In(burnTxHashes) })
      .execute();
  }

  async updateCollectorUnlockStatus(burnTxHash: string, blockNumber: number, status: CkbUnlockStatus): Promise<void> {
    await this.connection
      .getRepository(CollectorCkbUnlock)
      .createQueryBuilder()
      .update()
      .set({ blockNumber: blockNumber, status: status })
      .where({ burnTxHash })
      .execute();
  }

  async createCkbUnlock(records: ICkbUnlock[]): Promise<void> {
    const ckbUnlockRepo = this.connection.getRepository(CkbUnlock);
    const dbRecords = records.map((r) => ckbUnlockRepo.create(r));
    await ckbUnlockRepo.save(dbRecords);
  }

  async getEthBurnByUniqueIds(burnIds: string[]): Promise<EthBurn[]> {
    return await this.connection.getRepository(EthBurn).find({
      where: {
        uniqueId: In(burnIds),
      },
    });
  }

  async getEthMintByCkbTxHashes(ckbTxHashes: string[]): Promise<EthMint[]> {
    return await this.connection.getRepository(EthMint).find({
      where: {
        ckbTxHash: In(ckbTxHashes),
      },
    });
  }

  async getLatestCollectorCkbToUnlockRecord(): Promise<CollectorCkbUnlock | undefined> {
    return await this.connection.getRepository(CollectorCkbUnlock).findOne({
      where: {
        status: 'todo',
      },
      order: {
        createdAt: 'DESC',
      },
    });
  }

  async getCollectorCkbUnlockRecordsToUnlockByAssetIdent(assetIdent: string, take = 50): Promise<CollectorCkbUnlock[]> {
    return await this.connection.getRepository(CollectorCkbUnlock).find({
      where: {
        status: 'todo',
      },
      take,
    });
  }

  async ckbLockedByTxHashes(hashes: string[]): Promise<CkbLock[]> {
    return await this.connection.getRepository(CkbLock).find({
      where: {
        ckbTxHash: In(hashes),
      },
    });
  }
}
