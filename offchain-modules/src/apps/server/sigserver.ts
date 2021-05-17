import { SigServerConfig } from './config';
import { ethers } from 'ethers';
import { abi } from '@force-bridge/xchain/eth/abi/ForceBridge.json';
import { getMultisigLock } from '@force-bridge/ckb/tx-helper/multisig/multisig_helper';

const CKB = require('@nervosnetwork/ckb-sdk-core').default;

export class SigServer {
  static config: SigServerConfig;
  static ckb: typeof CKB;
  static ethProvider: ethers.providers.JsonRpcProvider;
  static ethInterface: ethers.utils.Interface;
  static ownLockHash: string;
  constructor(cfg: SigServerConfig) {
    SigServer.config = cfg;
    SigServer.ckb = new CKB(cfg.ckb.ckbRpcUrl);
    SigServer.ethProvider = new ethers.providers.JsonRpcProvider(SigServer.config.eth.rpcUrl);
    SigServer.ethInterface = new ethers.utils.Interface(abi);
  }

  static getOwnLockHash() {
    if (SigServer.ownLockHash) {
      return SigServer.ownLockHash;
    }
    const multisigLockScript = getMultisigLock(SigServer.config.ckb.multisigScript);
    SigServer.ownLockHash = SigServer.ckb.utils.scriptToHash(<CKBComponents.Script>{
      codeHash: multisigLockScript.code_hash,
      hashType: multisigLockScript.hash_type,
      args: multisigLockScript.args,
    });
    return SigServer.ownLockHash;
  }
}
