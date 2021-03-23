import { Buffer } from 'buffer';
import { sha256 } from 'eosjs/dist/eosjs-key-conversions';

export class EosAssetAmount {
  Amount: string;
  Asset: string;

  constructor(amount: string, asset: string) {
    this.Amount = amount;
    this.Asset = asset;
  }
}

//parseAssetAmount parse quantity "1.0000 EOS" to "1.0000" and "EOS"
export function parseAssetAmount(amount: string, decimal: number): EosAssetAmount {
  let idx = amount.indexOf('.') + decimal + 1;
  return new EosAssetAmount(amount.substring(0, idx).trim(), amount.substring(idx).trim());
}

export function getTxIdFromSerializedTx(serializedTx: Uint8Array): string {
  const buf = Buffer.from(serializedTx);
  return Buffer.from(sha256(buf)).toString('hex');
}
