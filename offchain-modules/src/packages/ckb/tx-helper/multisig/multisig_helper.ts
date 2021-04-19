import { serializeMultisigScript, multisigArgs } from '@ckb-lumos/common-scripts/lib/from_info';
import { getConfig } from '@ckb-lumos/config-manager';
import { key } from '@ckb-lumos/hd';
import { generateAddress } from '@ckb-lumos/helpers';
import { HexString } from '@ckb-lumos/base';
import { init } from './init_config';

init();
const config = getConfig();
const multisigTemplate = config.SCRIPTS.SECP256K1_BLAKE160_MULTISIG;
if (!multisigTemplate) {
  throw new Error('Multisig script template missing!');
}

const infos = require('./infos.json');
export const multisigScript = infos.multisigScript;

export const serializedMultisigScript = serializeMultisigScript(multisigScript);
const args = multisigArgs(serializedMultisigScript);

export const multisigLockScript = {
  code_hash: multisigTemplate.CODE_HASH,
  hash_type: multisigTemplate.HASH_TYPE,
  args,
};

export const multisigAddress = generateAddress(multisigLockScript);

export const fromPrivateKey = infos.fromPrivateKey;
const fromBlake160 = key.publicKeyToBlake160(key.privateToPublic(fromPrivateKey as HexString));

const secpTemplate = getConfig().SCRIPTS.SECP256K1_BLAKE160;

export const fromLockScript = {
  code_hash: secpTemplate.CODE_HASH,
  hash_type: secpTemplate.HASH_TYPE,
  args: fromBlake160,
};
export const fromAddress = generateAddress(fromLockScript);
