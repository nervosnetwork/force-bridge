import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  PrimaryColumn,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export type EosUnlockStatus = 'todo' | 'pending' | 'error' | 'success';

@Entity()
export class EosUnlock {
  @PrimaryColumn()
  ckbTxHash: string;

  @Column()
  asset: string;

  @Column()
  amount: string;

  @Column()
  recipientAddress: string;

  @Column({ nullable: true })
  eosTxHash: string;

  @Index()
  @Column({ default: 'todo' })
  status: EosUnlockStatus;

  @Column({ default: '' })
  message: string;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}
