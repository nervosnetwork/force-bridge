import {
  Entity,
  PrimaryGeneratedColumn,
  PrimaryColumn,
  CreateDateColumn,
  Column,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type TronUnlockStatus = 'todo' | 'pending' | 'error' | 'success';

@Entity()
export class TronUnlock {
  @PrimaryGeneratedColumn()
  id: number;

  @PrimaryColumn()
  ckbTxHash: string;

  @Column({ nullable: true })
  tronUnlockTxHash: string;

  @Column({ nullable: true })
  tronUnlockTxIndex: number;

  @Column()
  asset: string;

  @Column()
  assetType: string;

  @Column()
  amount: string;

  @Column({ default: '' })
  memo: string;

  @Index()
  @Column()
  recipientAddress: string;

  @Column({ default: 'todo' })
  status: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  from({
    tronUnlockTxHash = '',
    tronUnlockTxIndex = 0,
    asset,
    assetType,
    amount,
    memo,
    recipientAddress,
    status = 'todo',
  }: {
    tronUnlockTxHash?: string;
    tronUnlockTxIndex?: number;
    asset: string;
    assetType: string;
    amount: string;
    memo: string;
    recipientAddress: string;
    status?: string;
  }) {
    const record = new TronUnlock();
    record.tronUnlockTxHash = tronUnlockTxHash;
    record.tronUnlockTxIndex = tronUnlockTxIndex;
    record.asset = asset;
    record.assetType = assetType;
    record.amount = amount;
    record.memo = memo;
    record.recipientAddress = recipientAddress;
    record.status = status;
    return record;
  }
}
