import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type TxConfirmStatus = 'unconfirmed' | 'confirmed';

@Entity()
export class CkbLock {
  @PrimaryColumn()
  ckbTxHash: string;

  @Column()
  chain: number; // bridge to which chain

  @Index()
  @Column('varchar', { length: 1024 })
  senderAddress: string;

  @Column()
  assetIdent: string; // sudt/xudt typescript hash

  @Column()
  amount: string;

  @Column({ default: '0' })
  bridgeFee: string;

  @Index()
  @Column('varchar', { length: 2048 })
  recipientAddress: string;

  @Index()
  @Column()
  blockNumber: number;

  @Column({ type: 'bigint' })
  blockTimestamp: number;

  @Column({ default: 0 })
  confirmNumber: number;

  @Column({ default: 'unconfirmed' })
  confirmStatus: TxConfirmStatus;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}
