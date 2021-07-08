import fs from 'fs';
import { KeyStore } from '@force-bridge/keystore';
import CKB from '@nervosnetwork/ckb-sdk-core';
import nconf from 'nconf';
import { CkbIndexer } from './ckb/tx-helper/indexer';
import { Config } from './config';
import { asserts } from './errors';
import { ServerSingleton } from './server/serverSingleton';
import { initLog } from './utils/logger';

export function bootstrapKeyStore(
  keystorePath = 'keystore.json',
  password = process.env.FORCE_BRIDGE_KEYSTORE_PASSWORD || '',
): KeyStore<string> {
  const encrypted = JSON.parse(fs.readFileSync(keystorePath, 'utf8').toString());
  const store = new KeyStore(encrypted);

  store.decrypt(password);

  return store;
}

/**
 * call the bootstrap before your application starts.
 * @param options
 */
export async function bootstrap(configPath: string | Config): Promise<void> {
  if (ForceBridgeCore.initiated) {
    return;
  }
  let config: Config;
  if (typeof configPath === 'string') {
    nconf.env().file({ file: configPath });
    config = nconf.get('forceBridge');
  } else {
    config = configPath;
  }
  await new ForceBridgeCore().init(config);
}

// make global config and var static,
// which can be import from ForceBridgeCore
export class ForceBridgeCore {
  public static initiated = false;
  private static _config: Config;
  private static _ckb: CKB;
  private static _ckbIndexer: CkbIndexer;
  private static _keystore: KeyStore;

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

  static get keystore(): KeyStore {
    asserts(ForceBridgeCore._keystore, 'ForceBridgeCore is not init yet');
    return ForceBridgeCore._keystore;
  }

  /**
   * @deprecated migrate to {@link bootstrap}
   */
  constructor() {
    // TODO make constructor to be private
  }

  async init(config: Config): Promise<ForceBridgeCore> {
    // init log
    initLog(config.common.log);

    // set server port
    if (config.common.port) {
      ServerSingleton.getInstance().start(config.common.port);
    }
    // decrypt private key
    console.log('keystorePath', config.common.keystorePath);
    const keystore = bootstrapKeyStore(config.common.keystorePath);
    config.ckb.privateKey = keystore.getDecryptedByKeyID(config.ckb.privateKey);
    if (config.eth !== undefined) {
      config.eth.privateKey = keystore.getDecryptedByKeyID(config.eth.privateKey);
    }

    // write static
    ForceBridgeCore.initiated = true;
    ForceBridgeCore._ckb = new CKB(config.ckb.ckbRpcUrl);
    ForceBridgeCore._ckbIndexer = new CkbIndexer(config.ckb.ckbRpcUrl, config.ckb.ckbIndexerUrl);
    ForceBridgeCore._config = config;
    ForceBridgeCore._keystore = keystore;
    return this;
  }
}
