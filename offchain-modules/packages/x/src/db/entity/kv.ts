import { Column, PrimaryGeneratedColumn, Entity, Index } from 'typeorm';

@Entity()
export class KV {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column()
  key: string;

  @Column()
  value: string;
}
