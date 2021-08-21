// invoke in ckb handler
import { Connection, In, UpdateResult } from 'typeorm';
import { ChainType } from '../ckb/model/asset';
import { ForceBridgeCore } from '../core';
import { CollectorCkbMint, dbTxStatus } from './entity/CkbMint';
import { CollectorEthUnlock } from './entity/EthUnlock';
import {
  BtcUnlock,
  CkbBurn,
  CkbMint,
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
} from './model';

export class CkbDb {
  constructor(private connection: Connection) {}

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
}
