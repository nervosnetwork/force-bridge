import ethers from 'ethers';
import { WhiteListNervosAsset } from '../config';
import { StatDb } from '../db/stat';
import { getCachedAssetAVGPrice } from '../utils/price';
import Audit from './audit';

export class Nervos2Eth extends Audit {
  protected _msgDirection: 'Ethereum -> Nervos';

  mappedAssetWhiteList(assetWhiteList: WhiteListNervosAsset[]): Map<string, WhiteListNervosAsset> {
    const map: Map<string, WhiteListNervosAsset> = new Map();
    for (const asset of assetWhiteList) {
      map.set(asset.typescriptHash, asset);
    }

    return map;
  }

  async totalPrice(db: StatDb, assets: Map<string, WhiteListNervosAsset>, interval = 3600): Promise<ethers.BigNumber> {
    return await this.computeTotalPrice(await this.tokenWithBalance(db, interval), assets);
  }

  async tokenWithBalance(db: StatDb, interval: number): Promise<Map<string, ethers.BigNumber>> {
    const records = await db.getEthBurn(interval);
    const balance: Map<string, ethers.BigNumber> = new Map();
    for (const record of records) {
      balance.set(record.nervosAssetId, balance.get(record.nervosAssetId) || ethers.BigNumber.from(record.amount));
    }

    return balance;
  }

  async computeTotalPrice(
    balance: Map<string, ethers.BigNumber>,
    assets: Map<string, WhiteListNervosAsset>,
  ): Promise<ethers.BigNumber> {
    const sum = ethers.BigNumber.from(0);
    for (const typescriptHash in balance) {
      const asset = assets.get(typescriptHash);
      if (asset === undefined) {
        throw new Error(`asset ${typescriptHash} not in whitelist`);
      }

      sum.add(ethers.BigNumber.from(await getCachedAssetAVGPrice(asset.symbol)));
    }

    return sum;
  }
}
