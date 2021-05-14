import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity()
export class SignedTx {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  sigType: string;

  @Column()
  chain: number;

  @Column()
  amount: string;

  @Column()
  asset: string;

  @Column()
  refTxHash: string;

  @Column()
  txHash: string;

  @Column()
  signature: string;

  @Column()
  rawData: string;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}
