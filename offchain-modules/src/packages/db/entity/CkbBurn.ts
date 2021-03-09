import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity()
export class CkbBurn {
  @PrimaryColumn()
  txHash: string;

  @Column()
  chain: number;

  @Column()
  asset: string;

  @Column()
  amount: string;

  @Column()
  memo: string;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;

  from(data: { txHash: string; memo: string; amount: string; asset: string; chain: number }) {
    const record = new CkbBurn();
    record.txHash = data.txHash;
    record.chain = data.chain;
    record.asset = data.asset;
    record.amount = data.amount;
    record.memo = data.memo;
    return record;
  }
}
