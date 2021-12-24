import { Entity, Column, CreateDateColumn, UpdateDateColumn, Index, PrimaryColumn } from 'typeorm';

export type dbTxStatus = 'todo' | 'pending' | 'success' | 'error';
export type EthereumMintStatus = dbTxStatus;

@Entity()
export class EthereumMint {
  @PrimaryColumn()
  ckbTxHash: string;

  @Column()
  asset: string; // erc20 address

  @Column()
  amount: string;

  @Index()
  @Column('varchar', { length: 2048 })
  recipientAddress: string;

  @Index()
  @Column({ nullable: true })
  blockNumber: number;

  @Column({ type: 'bigint' })
  blockTimestamp: number;

  @Column({ nullable: true })
  ethTxHash: string;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}

@Entity()
export class CollectorEthereumMint extends EthereumMint {
  @Column({ default: 'todo' })
  status: EthereumMintStatus;

  @Column({ type: 'text', nullable: true })
  message: string;
}
