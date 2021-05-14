import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity()
export class BtcLock {
  @PrimaryColumn()
  txid: string;

  @Column()
  txHash: string;

  @Index()
  @Column()
  sender: string;

  @Column()
  amount: string;

  @Column()
  data: string;

  @Column('text')
  rawTx: string;

  @Column()
  blockHeight: number;

  @Column()
  blockHash: string;

  @Column()
  txIndex: number;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}
