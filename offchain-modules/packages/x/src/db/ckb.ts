// invoke in ckb handler
import { Connection, DeleteResult, UpdateResult } from 'typeorm';
import { ForceBridgeCore } from '../core';
import { dbTxStatus } from './entity/CkbMint';
import {
  BtcUnlock,
  CkbBurn,
  CkbMint,
  EosUnlock,
  EthUnlock,
  IBtcUnLock,
  ICkbBurn,
  IEosUnlock,
  IEthUnlock,
  ITronUnlock,
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

  async getCkbMintRecordsToMint(take = 300): Promise<CkbMint[]> {
    return this.connection.getRepository(CkbMint).find({
      where: {
        status: 'todo',
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

  async updateCkbMintStatus(mintTxHash: string, status: dbTxStatus) {
    return this.connection
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
      .where('block_number > :blockNumber', { blockNumber: confirmedBlockHeight })
      .execute();
  }

  async getUnconfirmedCkbBurnToConfirm(confirmedBlockHeight: number, limit = 100): Promise<CkbBurn[]> {
    return this.connection
      .getRepository(CkbBurn)
      .createQueryBuilder()
      .select()
      .where('block_number <= :confirmedHeight And confirm_status = "unconfirmed"', {
        confirmedHeight: confirmedBlockHeight,
      })
      .limit(limit)
      .getMany();
  }

  async updateCkbBurnConfirmStatus(txHashes: string[]): Promise<UpdateResult> {
    return this.connection
      .getRepository(CkbBurn)
      .createQueryBuilder()
      .update()
      .set({ confirmStatus: 'confirmed' })
      .where('ckb_tx_hash in (:txHashes)', { txHashes: txHashes })
      .execute();
  }
}
