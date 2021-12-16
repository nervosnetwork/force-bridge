import { Transaction } from '@ckb-lumos/base';
import { SerializeTransaction } from '@ckb-lumos/base/lib/core';
import { createTransactionFromSkeleton, TransactionSkeletonType } from '@ckb-lumos/helpers';
import { normalizers } from 'ckb-js-toolkit';

export function getTransactionSize(txSkeleton: TransactionSkeletonType): number {
  const tx = createTransactionFromSkeleton(txSkeleton);
  return getTransactionSizeByTx(tx);
}

export function getTransactionSizeByTx(tx: Transaction): number {
  const serializedTx = SerializeTransaction(normalizers.NormalizeTransaction(tx));
  // 4 is serialized offset bytesize
  return serializedTx.byteLength + 4;
}

export function calculateFee(size: number, feeRate = BigInt(10000)): bigint {
  const ratio = 1000n;
  const base = BigInt(size) * feeRate;
  const fee = base / ratio;
  if (fee * ratio < base) {
    return fee + 1n;
  }
  return fee;
}
