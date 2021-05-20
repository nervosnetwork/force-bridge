import { serializeMultisigScript, multisigArgs } from '@ckb-lumos/common-scripts/lib/from_info';
import { getConfig } from '@ckb-lumos/config-manager';
import { key } from '@ckb-lumos/hd';
import { generateAddress } from '@ckb-lumos/helpers';
import { HexString } from '@ckb-lumos/base';
import { init } from './init_config';
import { ForceBridgeCore } from '@force-bridge/core';
import { MultisigItem } from '@force-bridge/config';

init();
const config = getConfig();
const multisigTemplate = config.SCRIPTS.SECP256K1_BLAKE160_MULTISIG;
if (!multisigTemplate) {
  throw new Error('Multisig script template missing!');
}

const secpTemplate = getConfig().SCRIPTS.SECP256K1_BLAKE160;

export function getMultisigLock(multisigScript: MultisigItem) {
  const serializedMultisigScript = serializeMultisigScript(multisigScript);
  const args = multisigArgs(serializedMultisigScript);
  const multisigLockScript = {
    code_hash: multisigTemplate.CODE_HASH,
    hash_type: multisigTemplate.HASH_TYPE,
    args,
  };
  return multisigLockScript;
}

export function getOwnLockHash(multisigScript: MultisigItem): string {
  const multisigLockScript = getMultisigLock(multisigScript);
  const ownLockHash = ForceBridgeCore.ckb.utils.scriptToHash(<CKBComponents.Script>{
    codeHash: multisigLockScript.code_hash,
    hashType: multisigLockScript.hash_type,
    args: multisigLockScript.args,
  });
  return ownLockHash;
}

export function getMultisigAddr(multisigScript: MultisigItem): string {
  const multisigLockScript = getMultisigLock(multisigScript);
  return generateAddress(multisigLockScript);
}

export function getFromAddr(): string {
  const fromPrivateKey = ForceBridgeCore.config.ckb.fromPrivateKey;
  const fromBlake160 = key.publicKeyToBlake160(key.privateToPublic(fromPrivateKey as HexString));
  const fromLockScript = {
    code_hash: secpTemplate.CODE_HASH,
    hash_type: secpTemplate.HASH_TYPE,
    args: fromBlake160,
  };
  return generateAddress(fromLockScript);
}
