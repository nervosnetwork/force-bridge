import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type TxConfirmStatus = 'unconfirmed' | 'confirmed';

@Entity()
export class CkbLock {
  @PrimaryColumn()
  ckbTxHash: string;

  @Column()
  xchain: number; // bridge to which chain, 1 = Ethereum

  @Column('text')
  senderAddress: string; // ckb address

  @Column()
  assetIdent: string; // sudt/xudt typescript hash

  @Column()
  amount: string; // lock value

  @Column({ default: '0' })
  bridgeFee: string;

  @Column('varchar', { length: 10240 })
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
