// invoke in ckb handler
import { Connection, DeleteResult, In, UpdateResult } from 'typeorm';
import { ChainType } from '../ckb/model/asset';
import { ForceBridgeCore } from '../core';
import { dbTxStatus } from './entity/CkbMint';
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

  async getCkbMintRecordsToMint(status: dbTxStatus, take = 100): Promise<CkbMint[]> {
    return this.connection.getRepository(CkbMint).find({
      where: {
        status: status,
      },
      order: {
        createdAt: 'ASC',
      },
      take,
    });
  }

  async getMintRecordsToUpdate(mintHash: string): Promise<CkbMint[]> {
    return this.connection.getRepository(CkbMint).find({
      where: {
        mintHash: mintHash,
        status: 'pending',
      },
      order: {
        createdAt: 'ASC',
      },
    });
  }

  // update mint status
  async updateCkbMint(records: CkbMint[]): Promise<void> {
    await this.connection.manager.save(records);
  }

  async watcherCreateMint(mints: MintedRecords): Promise<void> {
    const dbRecords = mints.records.map((r) => {
      const mint: ICkbMint = {
        id: r.lockTxHash,
        chain: ChainType.ETH,
        amount: r.amount.toString(),
        asset: '',
        recipientLockscript: '',
        mintHash: mints.txHash,
        status: 'success',
      };
      return this.connection.getRepository(CkbMint).create(mint);
    });
    await this.connection.getRepository(CkbMint).save(dbRecords);
  }

  async updateBridgeInRecords(mintedRecords: MintedRecords): Promise<void> {
    const lockQuery = this.connection.getRepository(EthLock).createQueryBuilder();
    const mintQuery = this.connection.getRepository(CkbMint).createQueryBuilder();
    for (const record of mintedRecords.records) {
      const row = await lockQuery.select().where('tx_hash = :lockTxHash', { lockTxHash: record.lockTxHash }).getOne();
      if (row) {
        const bridgeFee = (BigInt(row.amount) - BigInt(record.amount)).toString();
        await lockQuery
          .update()
          .set({ bridgeFee: bridgeFee })
          .where('tx_hash = :lockTxHash', { lockTxHash: record.lockTxHash })
          .execute();
        await mintQuery
          .update()
          .set({ asset: row.token, recipientLockscript: row.recipient, sudtExtraData: row.sudtExtraData })
          .where('id = :lockTxHash', { lockTxHash: record.lockTxHash })
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

  async updateCkbMintStatus(mintTxHash: string, status: dbTxStatus): Promise<void> {
    await this.connection
      .getRepository(CkbMint)
      .createQueryBuilder()
      .update()
      .set({ status: status })
      .where('mintHash = :mintTxHash', { mintTxHash: mintTxHash })
      .execute();
  }

  async createCkbBurn(records: ICkbBurn[]): Promise<void> {
    const ckbBurnRepo = this.connection.getRepository(CkbBurn);
    const dbRecords = records.map((r) => ckbBurnRepo.create(r));
    await ckbBurnRepo.save(dbRecords);
  }

  /* save chain specific data */
  async createEthUnlock(records: IEthUnlock[]): Promise<void> {
    const ethUnlockRepo = this.connection.getRepository(EthUnlock);
    const dbRecords = records.map((r) => ethUnlockRepo.create(r));
    await ethUnlockRepo.save(dbRecords);
  }

  async createEosUnlock(records: IEosUnlock[]): Promise<void> {
    const eosUnlockRepo = this.connection.getRepository(EosUnlock);
    const dbRecords = records.map((r) => eosUnlockRepo.create(r));
    await eosUnlockRepo.save(dbRecords);
  }

  async createTronUnlock(records: ITronUnlock[]): Promise<void> {
    const tronUnlockRepo = this.connection.getRepository(TronUnlock);
    const dbRecords = records.map((r) => tronUnlockRepo.create(r));
    await tronUnlockRepo.save(dbRecords);
  }

  async createBtcUnlock(records: IBtcUnLock[]): Promise<void> {
    const btcUnlockRepo = this.connection.getRepository(BtcUnlock);
    const dbRecords = records.map((r) => btcUnlockRepo.create(r));
    await btcUnlockRepo.save(dbRecords);
  }

  async removeUnconfirmedCkbBurn(confirmedBlockHeight: number): Promise<DeleteResult> {
    return this.connection
      .getRepository(CkbBurn)
      .createQueryBuilder()
      .delete()
      .where('block_number > :blockNumber And confirm_status = "unconfirmed"', { blockNumber: confirmedBlockHeight })
      .execute();
  }

  async getUnconfirmedBurn(limit = 1000): Promise<CkbBurn[]> {
    return this.connection
      .getRepository(CkbBurn)
      .createQueryBuilder()
      .select()
      .where('confirm_status = "unconfirmed"')
      .limit(limit)
      .getMany();
  }

  async updateCkbBurnConfirmStatus(txHashes: string[]): Promise<UpdateResult> {
    return this.connection
      .getRepository(CkbBurn)
      .createQueryBuilder()
      .update()
      .set({ confirmStatus: 'confirmed' })
      .where({ ckbTxHash: In(txHashes) })
      .execute();
  }

  async updateBurnConfirmNumber(records: { txHash: string; confirmedNumber: number }[]): Promise<UpdateResult[]> {
    const updataResults = new Array(0);
    for (const record of records) {
      const result = await this.connection
        .getRepository(CkbBurn)
        .createQueryBuilder()
        .update()
        .set({ confirmNumber: record.confirmedNumber })
        .where('ckb_tx_hash = :txHash', { txHash: record.txHash })
        .execute();
      updataResults.push(result);
    }
    return updataResults;
  }

  async getCkbBurnByTxHashes(ckbTxHashes: string[]): Promise<ICkbBurn[]> {
    return this.connection.getRepository(CkbBurn).find({
      where: {
        ckbTxHash: In(ckbTxHashes),
      },
    });
  }
}
