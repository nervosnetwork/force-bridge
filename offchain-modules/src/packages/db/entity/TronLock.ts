import {
  Entity,
  PrimaryGeneratedColumn,
  VersionColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Column,
  Index,
} from 'typeorm';

export type TronAssetType = 'trx' | 'trc10' | 'trc20';

@Entity()
@Index(['tron_lock_tx_hash', 'tron_lock_index'])
export class TronLock {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  related_id: number;

  @Column()
  tron_lock_tx_hash: string;

  @Column()
  tron_lock_index: number;

  @Column()
  tron_sender: string;

  @Column()
  asset: string;

  @Column()
  asset_type: string;

  @Column()
  amount: string;

  @Column()
  memo: string;

  @Column()
  timestamp: number;

  @Column()
  committee: string;

  @VersionColumn()
  version: number;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  from({
    related_id,
    tron_lock_tx_hash,
    tron_lock_index,
    tron_sender,
    asset,
    asset_type,
    amount,
    memo,
    timestamp,
    committee,
  }: {
    related_id: number;
    tron_lock_tx_hash: string;
    tron_lock_index: number;
    tron_sender: string;
    asset: string;
    asset_type: string;
    amount: string;
    memo: string;
    timestamp: number;
    committee: string;
  }) {
    const record = new TronLock();
    record.related_id = related_id;
    record.tron_lock_tx_hash = tron_lock_tx_hash;
    record.tron_lock_index = tron_lock_index;
    record.tron_sender = tron_sender;
    record.asset = asset;
    record.asset_type = asset_type;
    record.amount = amount;
    record.memo = memo;
    record.timestamp = timestamp;
    record.committee = committee;
    return record;
  }
}
