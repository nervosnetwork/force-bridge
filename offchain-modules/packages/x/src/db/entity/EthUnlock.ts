import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { dbTxStatus } from './CkbMint';

export type EthUnlockStatus = dbTxStatus;

@Entity()
export class EthUnlock {
  @PrimaryColumn()
  ckbTxHash: string;

  @Column()
  asset: string;

  @Column()
  amount: string;

  @Column('varchar', { length: 10240 })
  recipientAddress: string;

  @Index()
  @Column({ nullable: true })
  blockNumber: number;

  @Column({ nullable: true })
  ethTxHash: string;

  @Column({ default: 'todo' })
  status: EthUnlockStatus;

  @Column({ type: 'text', nullable: true })
  message: string;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}
