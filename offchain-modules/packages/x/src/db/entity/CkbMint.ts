import { Entity, Column, CreateDateColumn, UpdateDateColumn, Index, PrimaryColumn } from 'typeorm';

export type dbTxStatus = 'todo' | 'pending' | 'success' | 'error';
export type CkbMintStatus = dbTxStatus;

@Entity()
export class CkbMint {
  @PrimaryColumn()
  id: string;

  @Column()
  chain: number;

  @Column()
  asset: string;

  @Column()
  amount: string;

  @Column('varchar', { length: 10240 })
  recipientLockscript: string;

  @Column('varchar', { length: 10240, default: '' })
  sudtExtraData: string;

  @Index()
  @Column({ nullable: true })
  blockNumber: number;

  @Index()
  @Column({ nullable: true })
  mintHash: string;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}

@Entity()
export class CollectorCkbMint extends CkbMint {
  @Column({ default: 'todo' })
  status: CkbMintStatus;

  @Column({ type: 'text', nullable: true })
  message: string;
}
