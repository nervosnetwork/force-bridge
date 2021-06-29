import { Script } from '@lay2/pw-core';
import * as utils from '@nervosnetwork/ckb-sdk-utils';
import { AddressPrefix } from '@nervosnetwork/ckb-sdk-utils';
import { ForceBridgeCore } from '../../core';
import { asserts } from '../../errors';

export class Account {
  public publicKey: string;
  public lockscript?: Script;
  public address: string;

  static scriptToAddress(
    script: CKBComponents.Script,
    network: string = ForceBridgeCore.config.common.network,
  ): string {
    if (script.codeHash === utils.systemScripts.SECP256K1_BLAKE160.codeHash) {
      if (network === 'mainnet')
        return utils.bech32Address(script.args, {
          prefix: AddressPrefix.Mainnet,
          type: utils.AddressType.HashIdx,
          codeHashOrCodeHashIndex: '0x00',
        });
      return utils.bech32Address(script.args, {
        prefix: AddressPrefix.Testnet,
        type: utils.AddressType.HashIdx,
        codeHashOrCodeHashIndex: '0x00',
      });
    } else {
      if (network === 'mainnet')
        return utils.bech32Address(script.args, {
          prefix: AddressPrefix.Mainnet,
          type: script.hashType === 'type' ? utils.AddressType.TypeCodeHash : utils.AddressType.DataCodeHash,
          codeHashOrCodeHashIndex: script.codeHash,
        });
      return utils.bech32Address(script.args, {
        prefix: AddressPrefix.Testnet,
        type: script.hashType === 'type' ? utils.AddressType.TypeCodeHash : utils.AddressType.DataCodeHash,
        codeHashOrCodeHashIndex: script.codeHash,
      });
    }
  }

  constructor(public privateKey: string, network: string = ForceBridgeCore.config.common.network) {
    this.publicKey = utils.privateKeyToPublicKey(privateKey);
    if (network === 'mainnet') {
      this.address = utils.pubkeyToAddress(this.publicKey, {
        prefix: AddressPrefix.Mainnet,
        type: utils.AddressType.HashIdx,
        codeHashOrCodeHashIndex: '0x00',
      });
    } else {
      this.address = utils.pubkeyToAddress(this.publicKey, {
        prefix: AddressPrefix.Testnet,
        type: utils.AddressType.HashIdx,
        codeHashOrCodeHashIndex: '0x00',
      });
    }
  }

  async getLockscript(): Promise<Script> {
    if (this.lockscript === undefined) {
      const { secp256k1Dep } = await ForceBridgeCore.ckb.loadDeps();

      asserts(secp256k1Dep);

      const args = `0x${utils.blake160(this.publicKey, 'hex')}`;
      const lockScript = Script.fromRPC({
        code_hash: secp256k1Dep.codeHash,
        args,
        hash_type: secp256k1Dep.hashType,
      });

      asserts(lockScript);

      this.lockscript = lockScript;
    }
    return this.lockscript;
  }
}
