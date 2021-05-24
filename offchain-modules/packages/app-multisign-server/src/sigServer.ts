import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { SignedDb } from '@force-bridge/x/dist/db/signed';
import { abi } from '@force-bridge/x/dist/xchain/eth/abi/ForceBridge.json';
import { ethers } from 'ethers';

export class SigServer {
  static ethProvider: ethers.providers.JsonRpcProvider;
  static ethInterface: ethers.utils.Interface;
  static ownLockHash: string;
  static signedDb: SignedDb;

  constructor(signedDb: SignedDb) {
    SigServer.ethProvider = new ethers.providers.JsonRpcProvider(ForceBridgeCore.config.eth.rpcUrl);
    SigServer.ethInterface = new ethers.utils.Interface(abi);
    SigServer.signedDb = signedDb;
  }
}
