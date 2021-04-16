import { Config } from './config';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const CKB = require('@nervosnetwork/ckb-sdk-core').default;
import { CkbIndexer } from '@force-bridge/ckb/tx-helper/indexer';

// make global config and var static,
// which can be import from ForceBridgeCore
export class ForceBridgeCore {
  static config: Config;
  static ckb: typeof CKB;
  // static indexer: Indexer;
  static ckbIndexer: CkbIndexer;

  async init(config: Config): Promise<ForceBridgeCore> {
    ForceBridgeCore.config = config;
    ForceBridgeCore.ckb = new CKB(config.ckb.ckbRpcUrl);
    ForceBridgeCore.ckbIndexer = new CkbIndexer(config.ckb.ckbRpcUrl, config.ckb.ckbIndexerUrl);
    // ForceBridgeCore.indexer = new Indexer(config.ckb.ckbRpcUrl, './lumos_db');
    // ForceBridgeCore.indexer.startForever();
    return this;
  }
}
