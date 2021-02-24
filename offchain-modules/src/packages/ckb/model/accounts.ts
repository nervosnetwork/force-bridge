import { Script } from '@lay2/pw-core';
import CKB from '@nervosnetwork/ckb-sdk-core';

export class Account {
    public publicKey: string;
    public lockscript?: Script;
    public address: string;

    constructor(public privateKey: string, public ckb: CKB) {
        this.publicKey = ckb.utils.privateKeyToPublicKey(privateKey);
        this.address = ckb.utils.pubkeyToAddress(this.publicKey);
    }

    async getLockscript(): Promise<Script> {
        if(this.lockscript === undefined) {
            const { secp256k1Dep } = await this.ckb.loadDeps();
            const args = `0x${ckb.utils.blake160(this.publicKey, 'hex')}`;
            this.lockscript = new Script(secp256k1Dep.codeHash, args, secp256k1Dep.hashType);
        }
        return this.lockscript;
    }
}