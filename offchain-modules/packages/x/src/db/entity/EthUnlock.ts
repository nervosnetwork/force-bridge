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

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}

@Entity()
export class CollectorEthUnlock extends EthUnlock {
  @Column({ default: 'todo' })
  status: EthUnlockStatus;

  @Column({ type: 'text', nullable: true })
  message: string;
}
