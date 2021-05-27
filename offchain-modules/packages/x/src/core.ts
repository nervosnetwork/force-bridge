import { Indexer } from '@ckb-lumos/sql-indexer';
import CKB from '@nervosnetwork/ckb-sdk-core';
import { CkbIndexer } from './ckb/tx-helper/indexer';
import { Config } from './config';
import { getLumosIndexKnex } from './utils';
// make global config and var static,
// which can be import from ForceBridgeCore
export class ForceBridgeCore {
  static config: Config;
  static ckb: CKB;
  static ckbIndexer: CkbIndexer;
  static lumosIndexer: Indexer;

  async init(config: Config): Promise<ForceBridgeCore> {
    ForceBridgeCore.config = config;
    ForceBridgeCore.ckb = new CKB(config.ckb.ckbRpcUrl);
    ForceBridgeCore.ckbIndexer = new CkbIndexer(config.ckb.ckbRpcUrl, config.ckb.ckbIndexerUrl);
    ForceBridgeCore.lumosIndexer = new Indexer(config.ckb.ckbRpcUrl, getLumosIndexKnex());
    return this;
  }
}
