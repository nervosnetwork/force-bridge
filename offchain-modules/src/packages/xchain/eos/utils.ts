import { Buffer } from 'buffer';
import { sha256 } from 'eosjs/dist/eosjs-key-conversions';

export class EosAssetAmount {
  Amount: string;
  Asset: string;

  constructor(amount: string, asset: string) {
    this.Amount = amount;
    this.Asset = asset;
  }

  static assetAmountFromQuantity(quantity: string): EosAssetAmount {
    //parse quantity "1.0000 EOS" to "1.0000" and "EOS"
    const res = quantity.match(/^(\d+\.\d+)\s*(\w+)?$/i);
    return new EosAssetAmount(res[1], res[2]);
  }
}

export function getTxIdFromSerializedTx(serializedTx: Uint8Array): string {
  const buf = Buffer.from(serializedTx);
  return Buffer.from(sha256(buf)).toString('hex');
}
