import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type TxConfirmStatus = 'unconfirmed' | 'confirmed';

@Entity()
export class CkbLock {
  @PrimaryColumn()
  ckbTxHash: string;

  @Column()
  chain: number; // bridge to which chain

  @Index()
  @Column('text')
  senderAddress: string;

  @Column({ default: 'sudt' })
  assetKind: string; // ckb = 'ckb', xudt = 'xudt'

  @Column()
  assetIdent: string; // args of asset typescript(empty string for ckb)

  @Column()
  amount: string;

  @Column({ default: '0' })
  bridgeFee: string;

  @Index()
  @Column('varchar', { length: 10240 })
  recipientAddress: string;

  @Index()
  @Column()
  blockNumber: number;

  @Column()
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
