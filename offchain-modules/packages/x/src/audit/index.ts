import { BigNumber } from 'bignumber.js';
import { ChainType } from '../ckb/model/asset';
import { AuditConfig, WhiteListEthAsset } from '../config';
import { StatDb } from '../db/stat';
import { foreverPromise } from '../utils';
import { logger } from '../utils/logger';
import { getCachedAssetAVGPrice } from '../utils/price';
import { Bot } from './discord';
import { TransferOutSwitch } from './switch';

// handle audit
export class Audit {
  private assetAddrMap: Map<string, WhiteListEthAsset> = new Map();
  bot: Bot;

  constructor(private statDb: StatDb, private assetWhiteList: WhiteListEthAsset[], private auditConfig: AuditConfig) {
    for (const asset of assetWhiteList) {
      this.assetAddrMap.set(asset.address, asset);
    }
    this.bot = new Bot(this.auditConfig.discordToken, auditConfig.channelId);
  }

  start(): void {
    void this.bot.start();
    void this.startAuditMonitor();
  }

  startAuditMonitor(): void {
    foreverPromise(
      async () => {
        const value = await this.getTransferOutValueSum(this.auditConfig.valueAccumulateInterval);
        let msg = `Nervos -> Ethereum Amount(USD) in 1 hour: $${value.toFixed(2)}\n`;
        if (value.gt(new BigNumber(this.auditConfig.auditThreshold))) {
          msg += `Transfer Out amount bigger than threshold($${this.auditConfig.auditThreshold}), turn the switch off\n`;
          TransferOutSwitch.getInstance().turnOff();
        }
        msg += `TransferOutSwitch status: ${TransferOutSwitch.getInstance().getStatus() ? 'ON' : 'OFF'}\n`;
        console.info(msg);
        await this.bot.sendMessage(msg);
      },
      {
        onRejectedInterval: this.auditConfig.sendStatusInterval,
        onResolvedInterval: this.auditConfig.sendStatusInterval,
        onRejected: (e: Error) => {
          logger.error(`handle audit error:${e.stack}`);
        },
      },
    );
  }

  // Get the sum of value in dollar which is transferred out from Nervos in specific interval
  async getTransferOutValueSum(interval = 3600): Promise<BigNumber> {
    const ckbBurnRecords = await this.statDb.getCkbBurn(interval);
    const assetBalance: Map<string, BigNumber> = new Map();
    for (const record of ckbBurnRecords) {
      if (record.chain !== ChainType.ETH) {
        throw new Error(`unsupport chain type: ${record.chain}`);
      }
      assetBalance.set(record.asset, (assetBalance.get(record.asset) || new BigNumber(0)).plus(record.amount));
    }
    let sum = new BigNumber(0);
    for (const [assetAddr, balance] of assetBalance) {
      const asset = this.assetAddrMap.get(assetAddr);
      if (asset === undefined) {
        throw new Error(`asset ${assetAddr} not in whitelist`);
      }
      const price = await getCachedAssetAVGPrice(asset.symbol);
      const priceBN = new BigNumber(price);
      sum = sum.plus(balance.multipliedBy(priceBN).div(Math.pow(10, asset.decimal)));
    }
    return sum;
  }
}
