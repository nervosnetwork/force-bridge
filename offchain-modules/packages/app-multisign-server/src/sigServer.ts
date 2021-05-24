import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { CkbDb } from '@force-bridge/x/dist/db';
import { SignedDb } from '@force-bridge/x/dist/db/signed';
import { abi } from '@force-bridge/x/dist/xchain/eth/abi/ForceBridge.json';
import { ethers } from 'ethers';
import { Connection } from 'typeorm';

export class SigServer {
  static ethProvider: ethers.providers.JsonRpcProvider;
  static ethInterface: ethers.utils.Interface;
  static ownLockHash: string;
  static conn: Connection;
  static signedDb: SignedDb;
  static ckbDb: CkbDb;

  constructor(conn: Connection) {
    SigServer.ethProvider = new ethers.providers.JsonRpcProvider(ForceBridgeCore.config.eth.rpcUrl);
    SigServer.ethInterface = new ethers.utils.Interface(abi);
    SigServer.conn = conn;
    SigServer.signedDb = new SignedDb(conn);
    SigServer.ckbDb = new CkbDb(conn);
  }
}
