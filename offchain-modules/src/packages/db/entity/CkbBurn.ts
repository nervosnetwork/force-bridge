import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity()
export class CkbBurn {
  @PrimaryColumn()
  ckbTxHash: string;

  @Column()
  chain: number;

  @Column()
  asset: string;

  @Column()
  amount: string;

  @Column()
  recipientAddress: string;

  @Index()
  @Column()
  blockNumber: number;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;

  from(data: { txHash: string; memo: string; amount: string; asset: string; chain: number }) {
    const record = new CkbBurn();
    record.ckbTxHash = data.txHash;
    record.chain = data.chain;
    record.asset = data.asset;
    record.amount = data.amount;
    record.recipientAddress = data.memo;
    return record;
  }
}
