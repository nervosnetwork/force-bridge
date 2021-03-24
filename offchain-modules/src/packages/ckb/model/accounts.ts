import { Script } from '@lay2/pw-core';
// import CKB from '@nervosnetwork/ckb-sdk-core';
const CKB = require('@nervosnetwork/ckb-sdk-core').default;
const CKB_URL = process.env.CKB_URL || 'http://127.0.0.1:8114';
const ckb = new CKB(CKB_URL);

export class Account {
  public publicKey: string;
  public lockscript?: Script;
  public address: string;

  constructor(public privateKey: string) {
    this.publicKey = ckb.utils.privateKeyToPublicKey(privateKey);
    this.address = ckb.utils.pubkeyToAddress(this.publicKey);
  }

  async getLockscript(): Promise<Script> {
    if (this.lockscript === undefined) {
      const { secp256k1Dep } = await ckb.loadDeps();
      const args = `0x${ckb.utils.blake160(this.publicKey, 'hex')}`;
      this.lockscript = Script.fromRPC({
        code_hash: secp256k1Dep.codeHash,
        args,
        hash_type: secp256k1Dep.hashType,
      });
    }
    return this.lockscript;
  }
}
