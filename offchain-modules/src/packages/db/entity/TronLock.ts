import {
  Entity,
  PrimaryGeneratedColumn,
  VersionColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Column,
  Index,
} from 'typeorm';

export type TronAssetType = 'trx' | 'trc10' | 'trc20';

@Entity()
@Index(['tronLockTxHash', 'tronLockIndex'], { unique: true })
export class TronLock {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column()
  tronLockTxHash: string;

  @Column()
  tronLockIndex: number;

  @Index()
  @Column()
  tronSender: string;

  @Column()
  asset: string;

  @Column()
  assetType: string;

  @Column()
  amount: string;

  @Column()
  memo: string;

  @Index()
  @Column({ type: 'bigint' })
  timestamp: number;

  @VersionColumn()
  version: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  from({
    tronLockTxHash,
    tronLockIndex,
    tronSender,
    asset,
    assetType,
    amount,
    memo,
    timestamp,
  }: {
    tronLockTxHash: string;
    tronLockIndex: number;
    tronSender: string;
    asset: string;
    assetType: string;
    amount: string;
    memo: string;
    timestamp: number;
  }) {
    const record = new TronLock();
    record.tronLockTxHash = tronLockTxHash;
    record.tronLockIndex = tronLockIndex;
    record.tronSender = tronSender;
    record.asset = asset;
    record.assetType = assetType;
    record.amount = amount;
    record.memo = memo;
    record.timestamp = timestamp;
    return record;
  }
}
