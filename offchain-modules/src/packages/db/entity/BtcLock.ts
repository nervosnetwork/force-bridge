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

  from(data: {
    txid: string;
    txHash: string;
    amount: string;
    data: string;
    rawTx: string;
    blockHeight: number;
    blockHash: string;
    txIndex: number;
  }) {
    const record = new BtcLock();
    record.txid = data.txid;
    record.txHash = data.txHash;
    record.amount = data.amount;
    record.data = data.data;
    record.rawTx = data.rawTx;
    record.blockHeight = data.blockHeight;
    record.blockHash = data.blockHash;
    record.txIndex = data.txIndex;
    return record;
  }
}
