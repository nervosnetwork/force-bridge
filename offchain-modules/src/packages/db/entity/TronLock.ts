import {
  Entity,
  PrimaryGeneratedColumn,
  VersionColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Column,
  Index,
  PrimaryColumn,
} from 'typeorm';

export type TronAssetType = 'trx' | 'trc10' | 'trc20';

@Entity()
@Index(['tronLockTxHash', 'tronLockIndex'], { unique: true })
export class TronLock {
  @Index()
  @Column()
  txHash: string;

  @Column()
  txIndex: number;

  @Index()
  @Column()
  sender: string;

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
