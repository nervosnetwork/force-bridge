import CKB from '@nervosnetwork/ckb-sdk-core';
import { CkbIndexer } from './ckb/tx-helper/indexer';
import { Config } from './config';
import { asserts } from './errors';

// make global config and var static,
// which can be import from ForceBridgeCore
export class ForceBridgeCore {
  private static _config: Config;
  private static _ckb: CKB;
  private static _ckbIndexer: CkbIndexer;

  static get config(): Config {
    asserts(ForceBridgeCore._config, 'ForceBridgeCore is not init yet');
    return ForceBridgeCore._config;
  }

  static get ckb(): CKB {
    asserts(ForceBridgeCore._config, 'ForceBridgeCore is not init yet');
    return ForceBridgeCore._ckb;
  }

  static get ckbIndexer(): CkbIndexer {
    asserts(ForceBridgeCore._config, 'ForceBridgeCore is not init yet');
    return ForceBridgeCore._ckbIndexer;
  }

  async init(config: Config): Promise<ForceBridgeCore> {
    ForceBridgeCore._config = config;
    ForceBridgeCore._ckb = new CKB(config.ckb.ckbRpcUrl);
    ForceBridgeCore._ckbIndexer = new CkbIndexer(config.ckb.ckbRpcUrl, config.ckb.ckbIndexerUrl);
    return this;
  }
}
