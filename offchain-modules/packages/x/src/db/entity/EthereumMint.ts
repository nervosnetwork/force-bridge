import { Entity, Column, CreateDateColumn, UpdateDateColumn, Index, PrimaryColumn } from 'typeorm';

export type dbTxStatus = 'todo' | 'pending' | 'success' | 'error';
export type EthereumMintStatus = dbTxStatus;

@Entity()
export class EthereumMint {
  @PrimaryColumn()
  ckbTxHash: string; // lock tx hash

  @Column()
  erc20TokenAddress: string; // erc20 address

  @Column()
  nervosAssetId: string; // sudt typescript hash

  @Column()
  amount: string;

  @Index()
  @Column('varchar', { length: 2048 })
  recipientAddress: string;

  @Index()
  @Column({ nullable: true })
  blockNumber: number; // mint tx block number

  @Column({ nullable: true, type: 'bigint' })
  blockTimestamp: number; // mint tx block timestamp

  @Column({ nullable: true })
  ethTxHash: string; // mint tx hash

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
