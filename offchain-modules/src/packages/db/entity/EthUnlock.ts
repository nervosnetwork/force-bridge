import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn, Index } from 'typeorm';

export type EthUnlockStatus = 'todo' | 'pending' | 'error' | 'success';

@Entity()
export class EthUnlock {
  @PrimaryColumn()
  ckbTxHash: string;

  @Column()
  asset: string;

  @Column()
  amount: string;

  @Column()
  recipientAddress: string;

  @Column({ nullable: true })
  ethTxHash: string;

  @Index()
  @Column({ default: 'todo' })
  status: EthUnlockStatus;

  @Column({ default: '' })
  message: string;
}
