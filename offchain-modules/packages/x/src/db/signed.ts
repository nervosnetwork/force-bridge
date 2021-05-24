import { Connection, In, Repository } from 'typeorm';
import { SignedTx } from './entity/SignedTx';
import { ISigned } from './model';

export class SignedDb {
  private signedRepository: Repository<SignedTx>;

  constructor(private conn: Connection) {
    this.signedRepository = conn.getRepository(SignedTx);
  }

  async createSigned(records: ISigned[]): Promise<void> {
    const dbRecords = records.map((r) => this.signedRepository.create(r));
    await this.signedRepository.save(dbRecords);
  }

  async getSignedByRefTxHashes(pubKey: string, refTxHashes: string[]): Promise<SignedTx[]> {
    return this.signedRepository
      .createQueryBuilder()
      .where('pubKey = :pubKey and refTxHash in (:refTxHashes)', { pubKey: pubKey, refTxHashes: refTxHashes })
      .orderBy('nonce', 'DESC')
      .getMany();
  }

  async getMaxNonceByRefTxHashes(pubKey: string, refTxHashes: string[]): Promise<number | undefined> {
    return this.signedRepository
      .createQueryBuilder()
      .select('max(nonce) as nonce')
      .where('pubKey = :pubKey and refTxHash in (:refTxHashes)', { pubKey: pubKey, refTxHashes: refTxHashes })
      .getRawOne();
  }

  async getDistinctSignedTxByRefTxHashes(pubKey: string, refTxHashes: string[]): Promise<string[] | undefined> {
    return this.signedRepository
      .createQueryBuilder()
      .select('distinct(txHash)')
      .where('pubKey = :pubKey and refTxHash in (:refTxHashes)', { pubKey: pubKey, refTxHashes: refTxHashes })
      .getRawMany();
  }
}
