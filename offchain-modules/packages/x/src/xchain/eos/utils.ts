import { Buffer } from 'buffer';
import { sha256 } from 'eosjs/dist/eosjs-key-conversions';

export class EosAssetAmount {
  Amount: string;
  Asset: string;
  Precision: number;
  constructor(amount: string, asset: string, precision = 4) {
    this.Amount = amount;
    this.Asset = asset;
    this.Precision = precision;
  }

  static assetAmountFromQuantity(quantity: string): EosAssetAmount {
    //parse quantity "1.0000 EOS" to "1.0000" and "EOS"
    const res = quantity.match(/^(\d+\.\d+)\s*(\w+)?$/i);
    return new EosAssetAmount(res[1], res[2], getPrecisionFromAmount(res[1]));
  }

  toString(): string {
    return `${this.Amount} ${this.Asset}`;
  }
}

export function getTxIdFromSerializedTx(serializedTx: Uint8Array): string {
  const buf = Buffer.from(serializedTx);
  return Buffer.from(sha256(buf)).toString('hex');
}

export function getPrecisionFromAmount(amount: string): number {
  amount = amount.trim();
  const index = amount.indexOf('.');
  return amount.length - index - 1;
}
