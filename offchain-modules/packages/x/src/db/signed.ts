import { Connection, DeleteResult, Equal, Repository } from 'typeorm';
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
      .where('pub_key = :pubKey and ref_tx_hash in (:refTxHashes)', { pubKey: pubKey, refTxHashes: refTxHashes })
      .orderBy('nonce', 'DESC')
      .getMany();
  }

  async getMaxNonceByRefTxHashes(pubKey: string, refTxHashes: string[]): Promise<{ nonce: number | null }> {
    return this.signedRepository
      .createQueryBuilder()
      .select('max(nonce) as nonce')
      .where('pub_key = :pubKey and ref_tx_hash in (:refTxHashes)', { pubKey: pubKey, refTxHashes: refTxHashes })
      .getRawOne();
  }

  async removeSignedRecordByNonce(nonce: number): Promise<DeleteResult> {
    return this.signedRepository.createQueryBuilder().delete().where('nonce = :nonce', { nonce: nonce }).execute();
  }

  async getDistinctRawDataByRefTxHashes(pubKey: string, refTxHashes: string[]): Promise<string[] | null> {
    return this.signedRepository
      .createQueryBuilder()
      .select('distinct(raw_data)')
      .where('pub_key = :pubKey and ref_tx_hash in (:refTxHashes)', { pubKey: pubKey, refTxHashes: refTxHashes })
      .getRawMany();
  }

  async getSignedByRawData(rawData: string): Promise<SignedTx | undefined> {
    return this.signedRepository.findOne({
      where: {
        rawData: Equal(rawData),
      },
    });
  }
}
