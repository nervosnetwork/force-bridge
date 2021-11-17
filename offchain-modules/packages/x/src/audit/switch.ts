// This class is a switch to control the behavior of transferring assets out from Nervos.
// When the statusOn if false, the collector will stop transferring assets out from Nervos.
export class TransferOutSwitch {
  private static instance: TransferOutSwitch;
  private statusOn: boolean;

  private constructor() {
    this.statusOn = true;
  }

  public static getInstance(): TransferOutSwitch {
    if (!TransferOutSwitch.instance) {
      TransferOutSwitch.instance = new TransferOutSwitch();
    }

    return TransferOutSwitch.instance;
  }

  public getStatus(): boolean {
    return this.statusOn;
  }

  public turnOn(): void {
    this.statusOn = true;
  }

  public turnOff(): void {
    this.statusOn = false;
  }
}
