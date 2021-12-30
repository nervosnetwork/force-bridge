import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type dbTxStatus = 'todo' | 'pending' | 'success' | 'error';
export type CkbUnlockStatus = dbTxStatus;

@Entity()
export class CkbUnlock {
  @PrimaryColumn()
  id: string; // ${burnTxHash}-${logIndex}

  @Column()
  burnTxHash: string;

  @Column()
  chain: number; // bridge from which chain

  @Column()
  assetIdent: string; // sudt/xudt typescript hash

  @Column()
  amount: string;

  @Index()
  @Column('varchar', { length: 1024 })
  recipientAddress: string;

  @Column('varchar', { length: 10240, default: '' })
  udtExtraData: string;

  @Index()
  @Column({ nullable: true })
  blockNumber: number;

  @Column({ type: 'bigint' })
  blockTimestamp: number;

  @Index()
  @Column({ nullable: true })
  unlockHash: string;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}

@Entity()
export class CollectorCkbUnlock extends CkbUnlock {
  @Column({ default: 'todo' })
  status: CkbUnlockStatus;

  @Column({ type: 'text', nullable: true })
  message: string;
}
