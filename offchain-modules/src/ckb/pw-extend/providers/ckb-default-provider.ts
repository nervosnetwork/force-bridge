import { Provider, Platform, Address, AddressType } from '@lay2/pw-core';
import CKB from '@nervosnetwork/ckb-sdk-core';

// CKB default provider. Used in nodejs. Sign with default single signature lockscript.
export class CkbDefaultProvider extends Provider {
    private ckb: CKB;
    constructor(private privateKey: string, public ckbRpcUrl: string) {
        super(Platform.ckb);
    }

    async init(): Promise<Provider> {
        const ckb = new CKB(this.ckbRpcUrl);
        this.ckb = ckb;
        const pubKey = ckb.utils.privateKeyToPublicKey(this.privateKey);
        const address = ckb.utils.pubkeyToAddress(pubKey);
        this.address = new Address(address, AddressType.ckb);
        return this;
    }

    async sign(message: string): Promise<string> {
        throw new Error('Method not implemented.');
    }

    close() {
        throw new Error('Method not implemented.');
    }
}