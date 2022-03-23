import ethers from 'ethers';
import { ChainType } from '../ckb/model/asset';
import { WhiteListEthAsset } from '../config';
import { StatDb } from '../db/stat';
import { getCachedAssetAVGPrice } from '../utils/price';
import Audit from './audit';

export class Eth2Nervos extends Audit {
  protected _msgDirection: 'Nervos -> Ethereum';

  mappedAssetWhiteList(assetWhiteList: WhiteListEthAsset[]): Map<string, WhiteListEthAsset> {
    const map: Map<string, WhiteListEthAsset> = new Map();
    for (const asset of assetWhiteList) {
      map.set(asset.address, asset);
    }

    return map;
  }

  async totalPrice(db: StatDb, assets: Map<string, WhiteListEthAsset>, interval = 3600): Promise<ethers.BigNumber> {
    return await this.computeTotalPrice(await this.tokenWithBalance(db, interval), assets);
  }

  async tokenWithBalance(db: StatDb, interval: number): Promise<Map<string, ethers.BigNumber>> {
    const records = await db.getCkbBurn(interval);
    const balance: Map<string, ethers.BigNumber> = new Map();
    for (const record of records) {
      switch (record.chain) {
        case ChainType.ETH:
          balance.set(record.asset, balance.get(record.asset) || ethers.BigNumber.from(record.amount));
          break;
        default:
          throw new Error(`unsupport chain type: ${record.chain}`);
      }
    }

    return balance;
  }

  async computeTotalPrice(
    balance: Map<string, ethers.BigNumber>,
    assets: Map<string, WhiteListEthAsset>,
  ): Promise<ethers.BigNumber> {
    const sum = ethers.BigNumber.from(0);
    for (const address in balance) {
      const asset = assets.get(address);
      if (asset === undefined) {
        throw new Error(`asset ${address} not in whitelist`);
      }

      sum.add(ethers.BigNumber.from(await getCachedAssetAVGPrice(asset.symbol)));
    }

    return sum;
  }
}
