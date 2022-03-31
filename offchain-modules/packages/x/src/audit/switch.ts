// This class is a switch to control the behavior of transferring assets out from Nervos.

import Audit from './audit';
import { DirectionName } from './type';

// When the statusOn if false, the collector will stop transferring assets out from Nervos.
export class TransferOutSwitch {
  private static instance: TransferOutSwitch;
  private statusOn: boolean;
  private audits: Map<string, Audit>;

  private constructor() {
    this.statusOn = true;
    this.audits = new Map();
  }

  public static getInstance(): TransferOutSwitch {
    if (!TransferOutSwitch.instance) {
      TransferOutSwitch.instance = new TransferOutSwitch();
    }

    return TransferOutSwitch.instance;
  }

  public addAudit(directionName: DirectionName, audit: Audit): void {
    this.audits.set(directionName, audit);
  }

  public getStatus(directionName: DirectionName): boolean {
    const audit = this.audits.get(directionName);
    if (audit === undefined) {
      return false;
    }

    return audit.status == 'on';
  }

  public turnOn(directionName?: DirectionName): void {
    if (directionName === undefined) {
      this.audits.forEach((v) => {
        v.status = 'on';
      });

      return;
    }

    const audit = this.audits.get(directionName);
    if (audit !== undefined) {
      audit.status = 'on';
    }
  }

  public turnOff(directionName?: DirectionName): void {
    if (directionName === undefined) {
      this.audits.forEach((v) => {
        v.status = 'off';
      });

      return;
    }

    const audit = this.audits.get(directionName);
    if (audit !== undefined) {
      audit.status = 'off';
    }
  }
}
