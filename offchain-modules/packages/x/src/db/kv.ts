import { Connection, Repository } from 'typeorm';
import { KV } from './entity/kv';

export class KVDb {
  private kvDb: Repository<KV>;
  constructor(private connection: Connection) {
    this.kvDb = connection.getRepository(KV);
  }
  async get(key: string): Promise<string | undefined> {
    const records = await this.kvDb.find({
      where: {
        key,
      },
      take: 1,
    });
    if (!records || records.length === 0) {
      return undefined;
    }
    return records[0].value;
  }

  async set(key: string, value: string) {
    return this.connection
      .createQueryBuilder()
      .insert()
      .into(KV)
      .values({ key: key, value: value })
      .orUpdate({ conflict_target: ['key'], overwrite: ['value'] })
      .execute();
  }
}
