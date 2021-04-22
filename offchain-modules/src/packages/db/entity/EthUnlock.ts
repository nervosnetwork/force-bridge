import { Entity, Column, PrimaryColumn, Index, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { dbTxStatus } from '@force-bridge/db/entity/CkbMint';

export type EthUnlockStatus = dbTxStatus;

@Entity()
export class EthUnlock {
  @PrimaryColumn()
  ckbTxHash: string;

  @Column()
  asset: string;

  @Column()
  amount: string;

  @Column()
  recipientAddress: string;

  @Column({ nullable: true })
  ethTxHash: string;

  @Index()
  @Column({ default: 'todo' })
  status: EthUnlockStatus;

  @Column({ default: '' })
  message: string;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}
