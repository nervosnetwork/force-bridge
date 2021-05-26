import { getMultisigLock } from '@force-bridge/x/dist/ckb/tx-helper/multisig/multisig_helper';
import { Config } from '@force-bridge/x/dist/config';
import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { SignedDb } from '@force-bridge/x/dist/db/signed';
import { abi } from '@force-bridge/x/dist/xchain/eth/abi/ForceBridge.json';
import { ethers } from 'ethers';
import { Connection, createConnection } from 'typeorm';

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
