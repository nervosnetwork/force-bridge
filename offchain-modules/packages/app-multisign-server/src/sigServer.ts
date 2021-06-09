import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { CkbDb, EthDb } from '@force-bridge/x/dist/db';
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
  static ethDb: EthDb;
  static keys: Map<string, Map<string, string>>;

  constructor(conn: Connection) {
    SigServer.ethProvider = new ethers.providers.JsonRpcProvider(ForceBridgeCore.config.eth.rpcUrl);
    SigServer.ethInterface = new ethers.utils.Interface(abi);
    SigServer.conn = conn;
    SigServer.signedDb = new SignedDb(conn);
    SigServer.ckbDb = new CkbDb(conn);
    SigServer.ethDb = new EthDb(conn);
    SigServer.keys = new Map<string, Map<string, string>>();

    if (ForceBridgeCore.config.ckb !== undefined) {
      const ckbKeys = new Map<string, string>();
      ForceBridgeCore.config.ckb.multiSignKeys.forEach((key) => {
        ckbKeys[key.address] = key.privKey;
      });
      SigServer.keys['ckb'] = ckbKeys;
    }
    if (ForceBridgeCore.config.eth.multiSignKeys !== undefined) {
      const ethKeys = new Map<string, string>();
      ForceBridgeCore.config.eth.multiSignKeys.forEach((key) => {
        ethKeys[key.address] = key.privKey;
      });
      SigServer.keys['eth'] = ethKeys;
    }
  }

  static getKey(chain: string, address: string): string | undefined {
    const keys = SigServer.keys[chain];
    if (keys === undefined) {
      return;
    }
    return keys[address];
  }
}
