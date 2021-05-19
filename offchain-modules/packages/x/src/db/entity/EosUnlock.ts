import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { dbTxStatus } from './CkbMint';

export type EosUnlockStatus = dbTxStatus;

@Entity()
export class EosUnlock {
  @PrimaryColumn()
  ckbTxHash: string;

  @Column()
  asset: string;

  @Column()
  amount: string;

  @Column()
  recipientAddress: string;

  @Column({ nullable: true })
  eosTxHash: string;

  @Column({ default: 'todo' })
  status: EosUnlockStatus;

  @Column({ type: 'text', nullable: true })
  message: string;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}
