import ethers from 'ethers';
import { AssetWhiteList, AuditConfig } from '../config';
import { StatDb } from '../db/stat';
import { foreverPromise } from '../utils';
import { logger } from '../utils/logger';
import { EventManager } from './event';
import { SwitchStatus } from './type';

abstract class Audit {
  protected _status: SwitchStatus;
  protected _eventManager: EventManager;
  protected abstract _msgDirection: string;

  abstract totalPrice(db: StatDb, mapped: Map<string, AssetWhiteList>, interval: number): Promise<ethers.BigNumber>;
  abstract mappedAssetWhiteList(assetWhiteList: AssetWhiteList[]): Map<string, AssetWhiteList>;

  constructor(eventManager: EventManager) {
    this._eventManager = eventManager;
    this._status = 'on';
  }

  start(db: StatDb, assetWhiteList: AssetWhiteList[], auditConfig: AuditConfig): void {
    foreverPromise(
      async () => {
        const totalPrice = await this.totalPrice(
          db,
          this.mappedAssetWhiteList(assetWhiteList),
          auditConfig.valueAccumulateInterval,
        );

        let msg = `${this._msgDirection} Amount(USD) in 1 hour: $${totalPrice.toString()}\n`;

        if (totalPrice.gt(ethers.BigNumber.from(auditConfig.auditThreshold))) {
          msg += `Transfer Out amount bigger than threshold($${auditConfig.auditThreshold}), turn the switch off\n`;
          this.status = 'off';
        }

        msg += `TransferOutSwitch status: ${this._status.toUpperCase()}\n`;

        this._eventManager.notify('notify_total_price', msg);
      },
      {
        onRejectedInterval: auditConfig.sendStatusInterval,
        onResolvedInterval: auditConfig.sendStatusInterval,
        onRejected: (e: Error) => {
          logger.error(`handle audit ${this._msgDirection} error. error: ${e.stack}`);
        },
      },
    );
  }

  public set status(status: SwitchStatus) {
    this._status = status;
  }

  public get status(): SwitchStatus {
    return this._status;
  }
}

export default Audit;
