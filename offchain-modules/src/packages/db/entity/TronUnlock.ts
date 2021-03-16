import { Entity, PrimaryGeneratedColumn, CreateDateColumn, Column, UpdateDateColumn, Index } from 'typeorm';

export type TronUnlockStatus = 'init' | 'pending' | 'success' | 'error';

@Entity()
@Index(['tronUnlockTxHash', 'tronUnlockTxIndex'], { unique: true })
export class TronUnlock {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tronUnlockTxHash: string;

  @Column()
  tronUnlockTxIndex: number;

  @Column()
  asset: string;

  @Column()
  assetType: string;

  @Column()
  amount: string;

  @Column()
  memo: string;

  @Index()
  @Column()
  tronRecipientAddress: string;

  @Column()
  status: string;

  @Column()
  committee: string;

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
    tronRecipientAddress,
    committee,
    status = 'init',
  }: {
    tronUnlockTxHash?: string;
    tronUnlockTxIndex?: number;
    asset: string;
    assetType: string;
    amount: string;
    memo: string;
    tronRecipientAddress: string;
    committee: string;
    status?: string;
  }) {
    const record = new TronUnlock();
    record.tronUnlockTxHash = tronUnlockTxHash;
    record.tronUnlockTxIndex = tronUnlockTxIndex;
    record.asset = asset;
    record.assetType = assetType;
    record.amount = amount;
    record.memo = memo;
    record.tronRecipientAddress = tronRecipientAddress;
    record.committee = committee;
    record.status = status;
    return record;
  }
}
