import {CkbMint, CkbBurn, EthLock, EthUnlock} from './model';

// invoke in ckb handler
export class CkbDb {
    // invoke when getting new burn events
    async saveCkbBurn(records: CkbBurn[]): Promise<void> {
        throw new Error('Method not implemented.')
    }

    async getCkbMintRecordsToMint(limit: number = 100): Promise<CkbMint[]> {
        throw new Error('Method not implemented.')
    }

    // update mint status
    async updateCkbMint(records: CkbMint[]): Promise<void> {
        throw new Error('Method not implemented.')
    }

    /* save chain specific data */
    async createEthUnlock(records: EthUnlock[]): Promise<void> {
        throw new Error('Method not implemented.')
    }
}

// invoke in eth handler
export class EthDb {
    async createCkbMint(records: CkbMint[]): Promise<boolean> {
        throw new Error('Method not implemented.')
    }

    async saveEthLock(records: EthLock[]): Promise<boolean> {
        throw new Error('Method not implemented.')
    }

    async getEthUnlockRecordsToUnlock(limit: number = 100): Promise<EthUnlock> {
        throw new Error('Method not implemented.')
    }

}