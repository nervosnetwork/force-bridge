import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export type CkbMintStatus = 'pending' | 'success' | 'error';

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
  recipient_address: string;

  @Column()
  sudt_extra_data: string;

  @Column()
  status: string;

  @CreateDateColumn()
  created_at: string;

  @UpdateDateColumn()
  updated_at: string;

  from({
    id,
    chain,
    amount,
    asset,
    recipient_address,
    sudt_extra_data = '',
    status = 'pending',
  }: {
    id: string;
    chain: number;
    amount: string;
    asset: string;
    recipient_address: string;
    sudt_extra_data?: string;
    status?: string;
  }) {
    const record = new CkbMint();
    record.id = id;
    record.chain = chain;
    record.asset = asset;
    record.amount = amount;
    record.recipient_address = recipient_address;
    record.sudt_extra_data = sudt_extra_data;
    record.status = status;
    return record;
  }
}
