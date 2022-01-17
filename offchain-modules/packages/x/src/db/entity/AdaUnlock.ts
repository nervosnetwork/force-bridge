import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { dbTxStatus } from './CkbMint';

export type AdaUnlockStatus = dbTxStatus;

@Entity()
export class AdaUnlock {
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
  adaTxHash: string;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}

@Entity()
export class CollectorAdaUnlock extends AdaUnlock {
  @Column({ default: 'todo' })
  status: AdaUnlockStatus;

  @Column({ type: 'text', nullable: true })
  message: string;
}
