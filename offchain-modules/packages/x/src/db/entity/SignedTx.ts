import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

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
  receiver: string;

  @Index()
  @Column({ nullable: true })
  txHash: string;

  @Column({ nullable: true })
  nonce: number;

  @Index()
  @Column()
  refTxHash: string;

  @Column()
  pubKey: string;

  @Column()
  rawData: string;

  @Column()
  signature: string;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}
