import { Connection, Repository } from 'typeorm';
import { KV } from './entity/kv';

export class KVDb {
  private kvDb: Repository<KV>;
  constructor(private connection: Connection) {
    this.kvDb = connection.getRepository(KV);
  }
  async get(key: string): Promise<KV[]> {
    return this.kvDb.find({
      where: {
        key,
      },
      take: 1,
    });
  }

  async set(key: string, value: string) {
    const updateRes = await this.kvDb
      .createQueryBuilder()
      .update()
      .set({ value: value })
      .where('key = :key', { key: key })
      .execute();
    if (updateRes.affected === 0) {
      await this.kvDb.save({ key: key, value: value });
    }
  }
}
