import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { TxConfirmStatus } from './EthLock';

@Entity()
export class CkbBurn {
  @PrimaryColumn()
  ckbTxHash: string;

  @Column()
  chain: number;

  @Index()
  @Column()
  senderAddress: string;

  @Column()
  asset: string;

  @Column()
  amount: string;

  @Column({ default: '0' })
  bridgeFee: string;

  @Column()
  recipientAddress: string;

  @Index()
  @Column()
  blockNumber: number;

  @Column({ default: 0 })
  confirmStatus: TxConfirmStatus;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;

  from(data: {
    ckbTxHash: string;
    recipientAddress: string;
    amount: string;
    bridgeFee: string;
    asset: string;
    chain: number;
    blockNumber: number;
    senderAddress: string;
  }) {
    const record = new CkbBurn();
    record.ckbTxHash = data.ckbTxHash;
    record.chain = data.chain;
    record.asset = data.asset;
    record.amount = data.amount;
    record.bridgeFee = data.bridgeFee;
    record.recipientAddress = data.recipientAddress;
    record.blockNumber = data.blockNumber;
    record.senderAddress = data.senderAddress;
    return record;
  }
}
