import { Entity, PrimaryGeneratedColumn, CreateDateColumn, Column, UpdateDateColumn, PrimaryColumn } from 'typeorm';

export type TronUnlockStatus = 'pending' | 'success' | 'error';

@Entity()
export class TronUnlock {
  @PrimaryColumn()
  ckb_burn_tx_hash: string;

  @Column()
  tron_unlock_tx_hash: string;

  @Column()
  ckb_sender: string;

  @Column()
  asset: string;

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
    ckb_burn_tx_hash,
    tron_unlock_tx_hash = '',
    ckb_sender,
    asset,
    amount,
    memo,
    tron_recipient_address,
    committee,
    status = 'pending',
  }: {
    ckb_burn_tx_hash: string;
    tron_unlock_tx_hash?: string;
    ckb_sender: string;
    asset: string;
    amount: string;
    memo: string;
    tron_recipient_address: string;
    committee: string;
    status?: string;
  }) {
    const record = new TronUnlock();
    record.ckb_burn_tx_hash = ckb_burn_tx_hash;
    record.tron_unlock_tx_hash = tron_unlock_tx_hash;
    record.ckb_sender = ckb_sender;
    record.asset = asset;
    record.amount = amount;
    record.memo = memo;
    record.tron_recipient_address = tron_recipient_address;
    record.committee = committee;
    record.status = status;
    return record;
  }
}
