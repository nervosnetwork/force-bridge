import { Entity, PrimaryColumn, CreateDateColumn, Column, UpdateDateColumn, Index } from 'typeorm';

export type TronUnlockStatus = 'todo' | 'pending' | 'error' | 'success';

@Entity()
export class TronUnlock {
  @PrimaryColumn()
  ckbTxHash: string;

  @Column({ nullable: true })
  tronTxHash: string;

  @Column({ nullable: true })
  tronTxIndex: number;

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

  @Column({ default: '' })
  message: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
