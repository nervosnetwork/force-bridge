import fs from 'fs';
import { KeyStore } from '@force-bridge/keystore';
import CKB from '@nervosnetwork/ckb-sdk-core';
import nconf from 'nconf';
import { CkbIndexer } from './ckb/tx-helper/indexer';
import { Config } from './config';
import { asserts } from './errors';

type KeyID = 'ckb' | 'eth';
function bootstrapKeyStore(
  keystorePath: string,
  password = process.env.FORCE_BRIDGE_KEYSTORE_PASSWORD || '',
): KeyStore<KeyID> {
  const encrypted = JSON.parse(fs.readFileSync(keystorePath, 'utf8').toString());
  const store = new KeyStore(encrypted);

  store.decrypt(password);

  return store;
}

interface BootstrapOptions {
  configPath?: string;
  keystorePath?: string;
}

export async function bootstrapForceBridgeCore(options: BootstrapOptions = {}): Promise<void> {
  const { configPath = './config.json', keystorePath = './keystore.json' } = options;

  // bootstrap keystore
  const store = bootstrapKeyStore(keystorePath);

  // bootstrap ForceBridgeCore
  nconf.env().file({ file: configPath });
  const config: Config = nconf.get('forceBridge');
  await new ForceBridgeCore().init(config);

  // TODO remove private key in ForceBridgeCore
  ForceBridgeCore.config.ckb.fromPrivateKey = store.getDecryptedByKeyID('ckb');
}

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
