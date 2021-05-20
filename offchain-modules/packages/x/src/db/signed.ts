import { Connection, In, Repository } from 'typeorm';
import { ISigned } from '@force-bridge/db/model';
import { SignedTx } from '@force-bridge/db/entity/SignedTx';

export class SignedDb {
  private signedRepository: Repository<SignedTx>;

  constructor(private conn: Connection) {
    this.signedRepository = conn.getRepository(SignedTx);
  }

  async createSigned(records: ISigned[]): Promise<void> {
    const dbRecords = records.map((r) => this.signedRepository.create(r));
    await this.signedRepository.save(dbRecords);
  }

  async getSignedByRefTxHashes(refTxHashes: string[]): Promise<SignedTx[]> {
    return this.signedRepository
      .createQueryBuilder('s')
      .where(`refTxHash in (${refTxHashes.join(',')})`)
      .getMany();
  }
  async getSignedByPubkeyAndMsgHash(pubkey: string, refTxHashes: string[]): Promise<SignedTx[]> {
    return this.signedRepository.find({
      where: {
        refTxHash: In([refTxHashes]),
        singerPubkey: pubkey,
      },
    });
  }
}
