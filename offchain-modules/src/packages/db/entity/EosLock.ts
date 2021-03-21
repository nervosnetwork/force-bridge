import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity()
export class EosLock {
  @PrimaryColumn()
  @Index()
  txHash: string;

  @Index()
  @Column()
  sender: string;

  @Index()
  @Column()
  token: string;

  @Column()
  amount: string;

  @Column()
  memo: string;

  @Column()
  accountActionSeq: number;

  @Column()
  globalActionSeq: number;

  @Index()
  @Column()
  blockNumber: number;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}
