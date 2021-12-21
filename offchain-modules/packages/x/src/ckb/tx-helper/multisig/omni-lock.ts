import { Script, utils } from '@ckb-lumos/base';
import { generateAddress } from '@ckb-lumos/helpers';
import { ForceBridgeCore } from '../../../core';

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
