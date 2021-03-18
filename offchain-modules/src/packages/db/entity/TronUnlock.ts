import {
  Entity,
  PrimaryGeneratedColumn,
  PrimaryColumn,
  CreateDateColumn,
  Column,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type TronUnlockStatus = 'todo' | 'pending' | 'error' | 'success';

@Entity()
export class TronUnlock {
  @PrimaryGeneratedColumn()
  id: number;

  @PrimaryColumn()
  ckbTxHash: string;

  @Column({ nullable: true })
  tronUnlockTxHash: string;

  @Column({ nullable: true })
  tronUnlockTxIndex: number;

  @Column()
  asset: string;

  @Column()
  assetType: string;

  @Column()
  amount: string;

  @Column({ default: '' })
  memo: string;

  @Index()
  @Column()
  recipientAddress: string;

  @Column({ default: 'todo' })
  status: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
