import {Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index} from 'typeorm';

@Entity()
export class WithdrawedBridgeFee {
  @PrimaryColumn()
  txHash: string;

  @PrimaryColumn()
  recipient: string;

  @Column()
  chain: number;

  @Index()
  @Column()
  blockNumber: number;

  @Column()
  asset: string;

  @Column()
  amount: string;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}
