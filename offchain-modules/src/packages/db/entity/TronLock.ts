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
}
