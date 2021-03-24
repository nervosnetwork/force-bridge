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
  receiptAddress: string;

  @Column()
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

  from(data: {
    txid: string;
    txHash: string;
    amount: string;
    receiptAddress: string;
    rawTx: string;
    blockHeight: number;
    blockHash: string;
    txIndex: number;
  }) {
    const record = new BtcLock();
    record.txid = data.txid;
    record.txHash = data.txHash;
    record.amount = data.amount;
    record.receiptAddress = data.receiptAddress;
    record.rawTx = data.rawTx;
    record.blockHeight = data.blockHeight;
    record.blockHash = data.blockHash;
    record.txIndex = data.txIndex;
    return record;
  }
}
