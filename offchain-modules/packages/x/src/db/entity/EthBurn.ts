import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { TxConfirmStatus } from './CkbLock';

@Entity()
export class EthBurn {
  @PrimaryColumn()
  uniqueId: string; // ${burnTxHash}-${logIndex}

  @Column()
  burnTxHash: string;

  @Index()
  @Column()
  sender: string;

  @Column()
  token: string; // erc20 address

  @Column()
  amount: string;

  @Column({ default: '0' })
  bridgeFee: string;

  @Index()
  @Column('varchar', { length: 10240 })
  recipient: string;

  @Column('varchar', { length: 10240, default: '' })
  sudtExtraData: string;

  @Index()
  @Column()
  blockNumber: number;

  @Column()
  blockTimestamp: number;

  @Column()
  blockHash: string;

  @Column({ default: 0 })
  confirmNumber: number;

  @Column({ default: 'unconfirmed' })
  confirmStatus: TxConfirmStatus;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;

  static primaryKey(logIndex: number, txHash: string): string {
    return `${txHash}-${logIndex}`;
  }
}
