import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity()
export class BtcLock {
  @PrimaryColumn()
  txid: string;

  @Column()
  txHash: string;

  @Column()
  amount: string;

  @Column()
  recipientAddress: string;

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
