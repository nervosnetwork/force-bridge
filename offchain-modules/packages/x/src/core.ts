import CKB from '@nervosnetwork/ckb-sdk-core';
import { CkbIndexer } from './ckb/tx-helper/indexer';
import { Config } from './config';

// make global config and var static,
// which can be import from ForceBridgeCore
export class ForceBridgeCore {
  static config: Config;
  static ckb: CKB;
  static ckbIndexer: CkbIndexer;

  async init(config: Config): Promise<ForceBridgeCore> {
    ForceBridgeCore.config = config;
    ForceBridgeCore.ckb = new CKB(config.ckb.ckbRpcUrl);
    ForceBridgeCore.ckbIndexer = new CkbIndexer(config.ckb.ckbRpcUrl, config.ckb.ckbIndexerUrl);
    return this;
  }
}
