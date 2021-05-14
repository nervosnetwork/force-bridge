import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

export type TronAssetType = 'trx' | 'trc10' | 'trc20';

@Entity()
@Index(['txHash', 'txIndex'], { unique: true })
export class TronLock {
  @PrimaryGeneratedColumn()
  id: number;

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
