// invoke in eth handler
import { CkbMint, EthLock, EthUnlock } from '@force-bridge/db/model';

export class EthDb {
  async createCkbMint(records: CkbMint[]): Promise<boolean> {
    throw new Error('Method not implemented.');
  }

  async saveEthLock(records: EthLock[]): Promise<boolean> {
    throw new Error('Method not implemented.');
  }

  async getEthUnlockRecordsToUnlock(limit: number = 100): Promise<EthUnlock> {
    throw new Error('Method not implemented.');
  }
}
