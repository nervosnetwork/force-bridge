import { Entity, Column, CreateDateColumn, UpdateDateColumn, Index, PrimaryColumn } from 'typeorm';

@Entity()
export class EosLock {
  @PrimaryColumn()
  id: string; //txHash + actionIndex

  @Index()
  @Column()
  txHash: string;

  @Column()
  actionIndex: number;

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
  actionPos: number;

  @Index()
  @Column()
  globalActionSeq: number;

  @Column()
  blockNumber: number;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}

export function getEosLockId(txHash: string, actionIndex: number): string {
  return `${txHash}_${actionIndex}`;
}
