import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity()
export class CkbBurn {
  @PrimaryColumn()
  tx_hash: string;

  @Column()
  chain: number;

  @Column()
  asset: string;

  @Column()
  amount: string;

  @Column()
  memo: string;

  @CreateDateColumn()
  created_at: string;

  @UpdateDateColumn()
  updated_at: string;

  from(data: { tx_hash: string; memo: string; amount: string; asset: string; chain: number }) {
    const record = new CkbBurn();
    record.tx_hash = data.tx_hash;
    record.chain = data.chain;
    record.asset = data.asset;
    record.amount = data.amount;
    record.memo = data.memo;
    return record;
  }
}
