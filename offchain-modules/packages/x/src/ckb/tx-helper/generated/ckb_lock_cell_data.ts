import Script = CKBComponents.Script;

export interface CkbLockCellData {
  chain: number;
  recipientAddress: string;
  recipientCapacity: string;
  asset: string;
  senderAddress: string;
  recipientLockscript: Script;
}
