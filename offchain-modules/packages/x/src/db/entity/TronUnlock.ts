import { Entity, PrimaryColumn, CreateDateColumn, Column, UpdateDateColumn, Index } from 'typeorm';
import { dbTxStatus } from '@force-bridge/db/entity/CkbMint';

export type TronUnlockStatus = dbTxStatus;

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

  @Column({ type: 'text', nullable: true })
  message: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
