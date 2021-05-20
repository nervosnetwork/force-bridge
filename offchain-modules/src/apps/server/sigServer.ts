import { ethers } from 'ethers';
import { abi } from '@force-bridge/xchain/eth/abi/ForceBridge.json';
import { getMultisigLock } from '@force-bridge/ckb/tx-helper/multisig/multisig_helper';
import { SignedDb } from '@force-bridge/db/signed';
import { Connection, createConnection } from 'typeorm';
import { Config } from '@force-bridge/config';
import { ForceBridgeCore } from '@force-bridge/core';

export class SigServer {
  // static config: SigServerConfig;
  // static ckb: typeof CKB;
  static ethProvider: ethers.providers.JsonRpcProvider;
  static ethInterface: ethers.utils.Interface;
  static ownLockHash: string;
  static signedDb: SignedDb;

  constructor(config: Config, conn: Connection) {
    // SigServer.config = cfg;
    // SigServer.ckb = new CKB(cfg.ckb.ckbRpcUrl);
    SigServer.ethProvider = new ethers.providers.JsonRpcProvider(config.eth.rpcUrl);
    SigServer.ethInterface = new ethers.utils.Interface(abi);
    // SigServer.signedDb = new SignedDb(conn);
  }

  static getOwnLockHash() {
    if (SigServer.ownLockHash) {
      return SigServer.ownLockHash;
    }
    const multisigLockScript = getMultisigLock(ForceBridgeCore.config.ckb.multisigScript);
    SigServer.ownLockHash = ForceBridgeCore.ckb.utils.scriptToHash(<CKBComponents.Script>{
      codeHash: multisigLockScript.code_hash,
      hashType: multisigLockScript.hash_type,
      args: multisigLockScript.args,
    });
    return SigServer.ownLockHash;
  }
}
