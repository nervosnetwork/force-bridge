import { HexString, Script } from '@ckb-lumos/base';
import { multisigArgs, serializeMultisigScript } from '@ckb-lumos/common-scripts/lib/from_info';
import { getConfig } from '@ckb-lumos/config-manager';
import { key } from '@ckb-lumos/hd';
import { encodeToAddress } from '@ckb-lumos/helpers';
import { MultisigItem } from '../../../config';
import { ForceBridgeCore } from '../../../core';
import { nonNullable } from '../../../errors';
import { parsePrivateKey } from '../../../utils';

const config = getConfig();
const multisigTemplate = nonNullable(config.SCRIPTS.SECP256K1_BLAKE160_MULTISIG);
if (!multisigTemplate) {
  throw new Error('Multisig script template missing!');
}

const secpTemplate = nonNullable(getConfig().SCRIPTS.SECP256K1_BLAKE160);

export function getMultisigLock(multisigScript: MultisigItem): Script {
  const serializedMultisigScript = serializeMultisigScript(multisigScript);
  const args = multisigArgs(serializedMultisigScript);
  const multisigLockscript = {
    codeHash: multisigTemplate.CODE_HASH,
    hashType: multisigTemplate.HASH_TYPE,
    args,
  };
  return multisigLockscript;
}

export function getOwnLockHash(multisigScript: MultisigItem): string {
  const multisigLockscript = getMultisigLock(multisigScript);
  const ownLockHash = ForceBridgeCore.ckb.utils.scriptToHash(<CKBComponents.Script>{
    codeHash: multisigLockscript.codeHash,
    hashType: multisigLockscript.hashType,
    args: multisigLockscript.args,
  });
  return ownLockHash;
}

export function getOwnerTypeHash(): string {
  const ownerTypeHash = ForceBridgeCore.ckb.utils.scriptToHash(<CKBComponents.Script>{
    codeHash: ForceBridgeCore.config.ckb.ownerCellTypescript.codeHash,
    hashType: ForceBridgeCore.config.ckb.ownerCellTypescript.hashType,
    args: ForceBridgeCore.config.ckb.ownerCellTypescript.args,
  });
  return ownerTypeHash;
}

export function getMultisigAddr(multisigScript: MultisigItem): string {
  const multisigLockscript = getMultisigLock(multisigScript);
  return encodeToAddress(multisigLockscript);
}

export function privateKeyToAddress(privateKey: string): string {
  const fromBlake160 = key.publicKeyToBlake160(key.privateToPublic(privateKey as HexString));
  const fromLockScript = {
    codeHash: secpTemplate.CODE_HASH,
    hashType: secpTemplate.HASH_TYPE,
    args: fromBlake160,
  };
  return encodeToAddress(fromLockScript);
}

export function getFromAddr(): string {
  const fromPrivateKey = parsePrivateKey(ForceBridgeCore.config.ckb.privateKey);
  return privateKeyToAddress(fromPrivateKey);
}
