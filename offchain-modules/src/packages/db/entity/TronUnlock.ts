import { Entity, PrimaryGeneratedColumn, CreateDateColumn, Column, UpdateDateColumn, Index } from 'typeorm';

export type TronUnlockStatus = 'pending' | 'success' | 'error';

@Entity()
@Index(['tron_unlock_tx_hash', 'tron_unlock_tx_index'])
export class TronUnlock {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  related_id: number;

  @Column()
  tron_unlock_tx_hash: string;

  @Column()
  tron_unlock_tx_index: number;

  @Column()
  asset: string;

  @Column()
  asset_type: string;

  @Column()
  amount: string;

  @Column()
  memo: string;

  @Column()
  tron_recipient_address: string;

  @Column()
  status: string;

  @Column()
  committee: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  from({
    related_id,
    tron_unlock_tx_hash = '',
    tron_unlock_tx_index = 0,
    asset,
    asset_type,
    amount,
    memo,
    tron_recipient_address,
    committee,
    status = 'pending',
  }: {
    related_id: number;
    tron_unlock_tx_hash?: string;
    tron_unlock_tx_index?: number;
    asset: string;
    asset_type: string;
    amount: string;
    memo: string;
    tron_recipient_address: string;
    committee: string;
    status?: string;
  }) {
    const record = new TronUnlock();
    record.related_id = related_id;
    record.tron_unlock_tx_hash = tron_unlock_tx_hash;
    record.tron_unlock_tx_index = tron_unlock_tx_index;
    record.asset = asset;
    record.asset_type = asset_type;
    record.amount = amount;
    record.memo = memo;
    record.tron_recipient_address = tron_recipient_address;
    record.committee = committee;
    record.status = status;
    return record;
  }
}
