import { HexString, utils } from '@ckb-lumos/base';
import { MultisigScript } from '@ckb-lumos/common-scripts';
import { serializeMultisigScript } from '@ckb-lumos/common-scripts/lib/secp256k1_blake160_multisig';
import * as util from '@nervosnetwork/ckb-sdk-utils';
import { Blake2b } from '@nervosnetwork/ckb-sdk-utils/lib/crypto/blake2b';
import { Reader } from 'ckb-js-toolkit';
import { Hasher, H256, SparseMerkleTree } from 'sparse-merkle-tree-ts';

export function getSmtRootAndProof(multisigScript: MultisigScript): { root: HexString; proof: HexString } {
  const serializedMultisigScript = serializeMultisigScript(multisigScript);
  const multisigScriptBlake160 = new utils.CKBHasher().update(serializedMultisigScript).digestHex().slice(0, 42);
  const authSmtKeyHex = `0x06${multisigScriptBlake160.slice(2)}${'00'.repeat(11)}`;
  const authSmtKeyH256 = new H256(new Reader(authSmtKeyHex).toArrayBuffer());

  const authSmtValue = H256.zero();
  authSmtValue[0] = 1;

  const keyOnWl1 = new H256([
    111, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);

  const keyOnWl2 = new H256([
    222, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);

  const tree = new SparseMerkleTree(() => new Blake2bHasher());
  tree.update(keyOnWl1, authSmtValue);
  tree.update(keyOnWl2, authSmtValue);
  tree.update(authSmtKeyH256, authSmtValue);

  const root = tree.root;
  const proof = tree.merkle_proof([authSmtKeyH256]);
  const compiled_proof = proof.compile([[authSmtKeyH256, authSmtValue]]);
  const rootFromProof = compiled_proof.compute_root([[authSmtKeyH256, authSmtValue]]);
  if (rootFromProof !== root) throw new Error('smt root generated from smt proof not equal to original root');

  return {
    root:
      '0x' +
      Array.from(root)
        .map((x) => x.toString(16).padStart(2, '0'))
        .join(''),
    proof: '0x' + compiled_proof.map((x) => x.toString(16).padStart(2, '0')).join(''),
  };
}

class Blake2bHasher extends Hasher {
  hasher: Blake2b;

  constructor() {
    super();

    this.hasher = util.blake2b(32, null, null, new TextEncoder().encode('ckb-default-hash'));
  }

  update(h: H256): this {
    this.hasher.update(h);

    return this;
  }

  final(): H256 {
    return new H256(this.hasher.final('binary') as Uint8Array);
  }
}
