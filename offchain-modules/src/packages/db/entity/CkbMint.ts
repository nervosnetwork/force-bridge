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
  recipientAddress: string;

  @Column()
  sudtExtraData: string;

  @Column()
  status: string;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;

  from({
    id,
    chain,
    amount,
    asset,
    recipientAddress,
    sudtExtraData = '',
    status = 'pending',
  }: {
    id: string;
    chain: number;
    amount: string;
    asset: string;
    recipientAddress: string;
    sudtExtraData?: string;
    status?: string;
  }) {
    const record = new CkbMint();
    record.id = id;
    record.chain = chain;
    record.asset = asset;
    record.amount = amount;
    record.recipientAddress = recipientAddress;
    record.sudtExtraData = sudtExtraData;
    record.status = status;
    return record;
  }
}
