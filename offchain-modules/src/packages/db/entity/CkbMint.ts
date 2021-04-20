import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export type CkbMintStatus = 'todo' | 'pending' | 'success' | 'error';

@Entity()
export class CkbMint {
  @PrimaryColumn()
  id: string;

  @Column()
  chain: number;

  @Column()
  asset: string;

  @Column()
  amount: string;

  @Column()
  recipientLockscript: string;

  // todo: save address when save lockscript
  // @Column()
  // recipientAddress: string;

  @Column({ default: '' })
  sudtExtraData: string;

  @Column({ default: 'todo' })
  status: string;

  @Column({ nullable: true })
  mintHash: string;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}
