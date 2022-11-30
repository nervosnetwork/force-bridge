import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity()
export class Sudt {
  @PrimaryGeneratedColumn('increment')
  id: number;

  @Column()
  txHash: string;

  @Column()
  direction: number;

  @Column({ length: 10240 })
  address: string;

  @Column()
  sudtArgs: string;

  @Column()
  amount: string;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}
