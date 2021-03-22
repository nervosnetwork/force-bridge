import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn } from 'typeorm';

@Entity()
export class BtcLock {
  @PrimaryColumn()
  txid: string;

  @Column()
  txHash: string;

  @Column()
  amount: string;

  @Column()
  data: string;

  @Column()
  rawTx: string;

  @Column()
  blockHeight: number;

  @Column()
  blockHash: string;

  @Column()
  txIndex: number;
}
