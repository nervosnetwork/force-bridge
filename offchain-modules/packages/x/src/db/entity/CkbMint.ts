import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

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

  @Column()
  recipientLockscript: string;

  // todo: save address when save lockscript
  // @Column()
  // recipientAddress: string;

  @Column({ default: '' })
  sudtExtraData: string;

  @Column({ default: 'todo' })
  status: CkbMintStatus;

  @Index()
  @Column({ nullable: true })
  mintHash: string;

  @Column({ type: 'text', nullable: true })
  message: string;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}
