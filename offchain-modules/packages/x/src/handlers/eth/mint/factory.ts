import { forceBridgeRole as ForceBridgeRole } from '../../../config';
import { EthDb, CkbDb } from '../../../db';
import { EthChain } from '../../../xchain/eth';
import Collector from './collector';
import Mint from './mint';
import Verifier from './verifier';
import Watcher from './watcher';

export abstract class Factory {
  static fromRole(role: ForceBridgeRole, ethDb: EthDb, ckbDb: CkbDb, ethChain: EthChain): Mint | undefined {
    switch (role) {
      case 'collector':
        return new Collector(ethDb, ckbDb, ethChain);
      case 'verifier':
        return new Verifier(ethDb, ckbDb, ethChain);
      case 'watcher':
        return new Watcher(ethDb, ckbDb, ethChain);
      default:
        return undefined;
    }
  }
}
