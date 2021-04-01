import { Entity, Column, PrimaryColumn, Index, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export type BtcUnlockStatus = 'todo' | 'pending' | 'error' | 'success';

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

  @Index()
  @Column({ default: 'todo' })
  status: BtcUnlockStatus;

  @Column({ type: 'text', nullable: true })
  message: string;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}
