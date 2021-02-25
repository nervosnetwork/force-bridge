import CKB from '@nervosnetwork/ckb-sdk-core';
import { CellDep, ConfigItem } from '@lay2/pw-core';
import { Config } from './config';

// make global config and var static,
// which can be import from ForceBridgeCore
export class ForceBridgeCore {
  static config: Config;
  static ckb: CKB;

  async init(config: Config): Promise<ForceBridgeCore> {
    ForceBridgeCore.config = config;
    ForceBridgeCore.ckb = new CKB(config.ckb.ckbRpcUrl);
    return this;
  }
}
