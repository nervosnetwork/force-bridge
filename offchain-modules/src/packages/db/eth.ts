// invoke in eth handler
import { CkbMint, EthLock, EthUnlock } from '@force-bridge/db/model';
import { Connection } from 'typeorm';

export class EthDb {
  constructor(private connection: Connection) {}
  async createCkbMint(records: CkbMint[]): Promise<void> {
    await this.connection.manager.save(records);
  }

  async saveEthLock(records: EthLock[]): Promise<void> {
    await this.connection.manager.save(records);
  }

  async getEthUnlockRecordsToUnlock(limit: number = 100): Promise<EthUnlock> {
    throw new Error('Method not implemented.');
  }
}
