import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type txConfirmStatus = 'unconfirmed' | 'confirmed';

@Entity()
export class EthLock {
  @PrimaryColumn()
  txHash: string;

  @Index()
  @Column()
  sender: string;

  @Index()
  @Column()
  token: string;

  @Column()
  amount: string;

  @Index()
  @Column()
  recipient: string;

  @Column()
  sudtExtraData: string;

  @Index()
  @Column()
  blockNumber: number;

  @Column()
  blockHash: string;

  @Column({ default: 'unconfirmed' })
  confirmStatus: txConfirmStatus;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}
