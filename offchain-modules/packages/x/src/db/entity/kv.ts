import { Column, PrimaryGeneratedColumn, Entity, Index } from 'typeorm';

@Entity()
export class KV {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column()
  key: string;

  @Column()
  value: string;
}
