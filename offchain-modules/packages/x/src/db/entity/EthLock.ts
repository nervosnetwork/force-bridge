import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

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

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}
