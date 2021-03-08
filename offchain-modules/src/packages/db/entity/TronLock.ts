import { Entity, CreateDateColumn, UpdateDateColumn, Column, PrimaryColumn } from 'typeorm';

@Entity()
export class TronLock {
  @PrimaryColumn()
  ckb_mint_tx_hash: string;

  @Column()
  tron_lock_tx_hash: string;

  @Column()
  tron_sender: string;

  @Column()
  asset: string;

  @Column()
  amount: string;

  @Column()
  memo: string;

  @Column()
  ckb_recipient_address: string;

  @Column()
  committee: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  from({
    ckb_mint_tx_hash,
    tron_lock_tx_hash,
    tron_sender,
    asset,
    amount,
    memo,
    ckb_recipient_address,
    committee,
  }: {
    ckb_mint_tx_hash: string;
    tron_lock_tx_hash: string;
    tron_sender: string;
    asset: string;
    amount: string;
    memo: string;
    ckb_recipient_address: string;
    committee: string;
  }) {
    const record = new TronLock();
    record.ckb_mint_tx_hash = ckb_mint_tx_hash;
    record.tron_lock_tx_hash = tron_lock_tx_hash;
    record.tron_sender = tron_sender;
    record.asset = asset;
    record.amount = amount;
    record.memo = memo;
    record.ckb_recipient_address = ckb_recipient_address;
    record.committee = committee;
    return record;
  }
}
