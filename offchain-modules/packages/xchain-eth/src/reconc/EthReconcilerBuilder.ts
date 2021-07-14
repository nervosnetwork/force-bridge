import { FromRecord, Reconciler, Reconciliation, ToRecord } from '@force-bridge/reconc';
import { EthAsset } from '@force-bridge/x/dist/ckb/model/asset';
import { CKBRecordObservable } from '@force-bridge/x/dist/reconc/CKBRecordObservable';
import { uint8ArrayToString } from '@force-bridge/x/dist/utils';
import { firstValueFrom } from 'rxjs';
import { toArray } from 'rxjs/operators';
import { EthRecordObservable } from './EthRecordObservable';

function normalHex(hexStr: string): string {
  return (hexStr.startsWith('0x') ? hexStr : '0x' + hexStr).toLowerCase();
}

function compareHex(hexStr1: string, hexStr2: string): boolean {
  return normalHex(hexStr1) === normalHex(hexStr2);
}

export interface TwoWayRecordObservable {
  xchainRecordObservable: EthRecordObservable;
  ckbRecordObservable: CKBRecordObservable;
}

export class EthLockReconciler implements Reconciler {
  constructor(private twoWayRecordObservable: TwoWayRecordObservable, public asset: string, public account?: string) {}

  async getFromRecordsByOnChainState(): Promise<FromRecord[]> {
    const observable = this.twoWayRecordObservable.xchainRecordObservable;
    return firstValueFrom(observable.observeLockRecord({ token: this.asset }).pipe(toArray()));
  }

  async getToRecordsByLocalState(): Promise<ToRecord[]> {
    const observable = this.twoWayRecordObservable.ckbRecordObservable.observeMintRecord({
      asset: new EthAsset(this.asset),
    });

    return firstValueFrom(observable.pipe(toArray()));
  }

  async fetchReconciliation(): Promise<Reconciliation> {
    const [from, to] = await Promise.all([this.getFromRecordsByOnChainState(), this.getToRecordsByLocalState()]);
    return new Reconciliation(from, to);
  }
}

export class EthUnlockReconciler implements Reconciler {
  constructor(private twoWayRecordObservable: TwoWayRecordObservable, public asset: string, public account?: string) {}

  async getFromRecordsByOnChainState(): Promise<FromRecord[]> {
    const observable = this.twoWayRecordObservable.ckbRecordObservable;
    const ownerCellTypeHash = new EthAsset(this.asset).ownerCellTypeHash;

    const fromRecords$ = observable.observeBurnRecord({
      filterRecipientData: (data) => {
        const assetBuffer = data.getAsset().raw();
        const assetAddress = uint8ArrayToString(new Uint8Array(assetBuffer));
        const recipientOwnerCellTypeHash = Buffer.from(data.getOwnerCellTypeHash().raw()).toString('hex');
        return (
          this.asset.toLowerCase() === assetAddress.toLowerCase() &&
          compareHex(recipientOwnerCellTypeHash, ownerCellTypeHash)
        );
      },
    });

    return firstValueFrom(fromRecords$.pipe(toArray()));
  }

  async getToRecordsByLocalState(): Promise<ToRecord[]> {
    return firstValueFrom(
      this.twoWayRecordObservable.xchainRecordObservable.observeUnlockRecord({ token: this.asset }).pipe(toArray()),
    );
  }

  async fetchReconciliation(): Promise<Reconciliation> {
    const [from, to] = await Promise.all([this.getFromRecordsByOnChainState(), this.getToRecordsByLocalState()]);
    return new Reconciliation(from, to);
  }
}

export class EthReconcilerBuilder {
  constructor(private twoWayRecordObservable: TwoWayRecordObservable) {}

  buildLockReconciler(ethAssetAddress: string): EthLockReconciler {
    return new EthLockReconciler(this.twoWayRecordObservable, ethAssetAddress);
  }

  buildUnlockReconciler(ethAssetAddress: string): EthUnlockReconciler {
    return new EthUnlockReconciler(this.twoWayRecordObservable, ethAssetAddress);
  }
}
