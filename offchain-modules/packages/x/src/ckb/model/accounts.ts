import { Script } from '@lay2/pw-core';
import { ForceBridgeCore } from '../../core';

export class Account {
  public publicKey: string;
  public lockscript?: Script;
  public address: string;

  constructor(public privateKey: string) {
    this.publicKey = ForceBridgeCore.ckb.utils.privateKeyToPublicKey(privateKey);
    this.address = ForceBridgeCore.ckb.utils.pubkeyToAddress(this.publicKey);
  }

  async getLockscript(): Promise<Script> {
    if (this.lockscript === undefined) {
      const { secp256k1Dep } = await ForceBridgeCore.ckb.loadDeps();
      const args = `0x${ForceBridgeCore.ckb.utils.blake160(this.publicKey, 'hex')}`;
      this.lockscript = Script.fromRPC({
        code_hash: secp256k1Dep.codeHash,
        args,
        hash_type: secp256k1Dep.hashType,
      });
    }
    return this.lockscript;
  }
}
