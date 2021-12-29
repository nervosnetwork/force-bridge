import { Script, utils } from '@ckb-lumos/base';
import { SerializeWitnessArgs } from '@ckb-lumos/base/lib/core';
import { serializeMultisigScript } from '@ckb-lumos/common-scripts/lib/from_info';
import { SECP_SIGNATURE_PLACEHOLDER } from '@ckb-lumos/common-scripts/lib/helper';
import { generateAddress } from '@ckb-lumos/helpers';
import { normalizers, Reader } from 'ckb-js-toolkit';
import { ForceBridgeCore } from '../../../core';
import { SerializeRcLockWitnessLock } from '../generated/omni_lock';

export function getOmniLockMultisigAddress(): string {
  const typeIdHash = utils.computeScriptHash(ForceBridgeCore.config.ckb.omniLockAdminCellTypescript!);
  const omniLockArgs = `0x000000000000000000000000000000000000000000` + `01` + `${typeIdHash.substring(2)}`;
  const omniLockscript: Script = {
    code_hash: ForceBridgeCore.config.ckb.deps.omniLock!.script.codeHash,
    hash_type: ForceBridgeCore.config.ckb.deps.omniLock!.script.hashType,
    args: omniLockArgs,
  };
  return generateAddress(omniLockscript);
}

export function getOmniLockMultisigWitnessPlaceholder(): string {
  const multisigScript = ForceBridgeCore.config.ckb.multisigScript;
  const serializedMultisigScript = serializeMultisigScript(multisigScript);
  const signaturePlaceHolder = serializedMultisigScript + SECP_SIGNATURE_PLACEHOLDER.slice(2).repeat(multisigScript.M);
  const authMultisigBlake160 = new utils.CKBHasher().update(serializedMultisigScript).digestHex().slice(0, 42);

  const omniLockWitness = {
    signature: new Reader(signaturePlaceHolder),
    rc_identity: {
      identity: new Reader(`0x06${authMultisigBlake160.slice(2)}`),
      proofs: [{ mask: 3, proof: new Reader(ForceBridgeCore.getSmtProof()) }],
    },
  };
  const omniLockWitnessHexString = new Reader(SerializeRcLockWitnessLock(omniLockWitness)).serializeJson();
  return new Reader(
    SerializeWitnessArgs(
      normalizers.NormalizeWitnessArgs({
        lock: `0x${'0'.repeat(omniLockWitnessHexString.length - 2)}`,
      }),
    ),
  ).serializeJson();
}
