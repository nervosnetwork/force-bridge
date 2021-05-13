import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { dbTxStatus } from '@force-bridge/db/entity/CkbMint';

export type BtcUnlockStatus = dbTxStatus;

@Entity()
export class BtcUnlock {
  @PrimaryColumn()
  ckbTxHash: string;

  @Column()
  chain: number;

  @Column()
  asset: string;

  @Column()
  amount: string;

  @Column()
  recipientAddress: string;

  @Column({ nullable: true })
  btcTxHash: string;

  @Column({ default: 'todo' })
  status: BtcUnlockStatus;

  @Column({ type: 'text', nullable: true })
  message: string;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}
