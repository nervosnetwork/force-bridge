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

  @Column({ default: 'sudt' })
  assetKind: string; // ckb = 'ckb', xudt = 'xudt'

  @Column()
  assetIdent: string; // args of typescript(empty string if ckb asset)

  @Column()
  amount: string;

  @Index()
  @Column('varchar', { length: 10240 })
  recipientAddress: string;

  @Column('varchar', { length: 10240, default: '' })
  extraData: string;

  @Index()
  @Column({ nullable: true })
  blockNumber: number;

  @Column()
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
