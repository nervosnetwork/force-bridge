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
  xchain: number; // bridge from which chain, 1 = Ethereum

  @Column()
  assetIdent: string; // related sudt/xudt typescript hash

  @Column()
  amount: string;

  @Column('text')
  recipientAddress: string; // ckb address

  @Column('varchar', { length: 10240, default: '' })
  udtExtraData: string;

  @Index()
  @Column({ nullable: true })
  blockNumber: number;

  @Column()
  blockTimestamp: number;

  @Index()
  @Column({ nullable: true })
  unlockTxHash: string; // ckb tx hash

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
