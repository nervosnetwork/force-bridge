import { Entity, Column, CreateDateColumn, UpdateDateColumn, Index, PrimaryColumn } from 'typeorm';

export type dbTxStatus = 'todo' | 'pending' | 'success' | 'error';
export type EthMintStatus = dbTxStatus;

@Entity()
export class EthMint {
  @PrimaryColumn()
  ckbTxHash: string;

  @Column()
  nervosAssetId: string; // sudt typescript hash

  @Column()
  erc20TokenAddress: string; // erc20 address

  @Column()
  amount: string;

  @Index()
  @Column('varchar', { length: 10240 })
  recipientAddress: string;

  @Index()
  @Column({ nullable: true })
  blockNumber: number;

  @Column()
  blockTimestamp: number;

  @Column({ nullable: true })
  ethTxHash: string;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}

@Entity()
export class CollectorEthMint extends EthMint {
  @Column({ default: 'todo' })
  status: EthMintStatus;

  @Column({ type: 'text', nullable: true })
  message: string;
}
