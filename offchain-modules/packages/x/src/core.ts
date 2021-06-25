import fs from 'fs';
import { KeyStore } from '@force-bridge/keystore';
import CKB from '@nervosnetwork/ckb-sdk-core';
import { has } from 'lodash';
import nconf from 'nconf';
import { CkbIndexer } from './ckb/tx-helper/indexer';
import { Config } from './config';
import { asserts } from './errors';
import { logger } from './utils/logger';

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

/**
 * call the bootstrap before your application starts.
 * @param options
 */
export async function bootstrap(options: BootstrapOptions = {}): Promise<void> {
  const { configPath = './config.json', keystorePath = './keystore.json' } = options;

  // bootstrap ForceBridgeCore
  nconf.env().file({ file: configPath });
  const config: Config = nconf.get('forceBridge');
  const keystore = bootstrapKeyStore(keystorePath);
  await new ForceBridgeCore().init(config, keystore);
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

  /**
   * @deprecated migrate to {@link bootstrap}
   * @param config
   * @returns
   */
  async init(
    config: Config,
    keystore: KeyStore<KeyID> = bootstrapKeyStore('./keystore.json'),
  ): Promise<ForceBridgeCore> {
    if (has(config, 'ckb.fromPrivateKey')) logger.warn('config.ckb.fromPrivateKey is deprecated.');

    ForceBridgeCore._config = config;
    ForceBridgeCore._ckb = new CKB(config.ckb.ckbRpcUrl);
    ForceBridgeCore._ckbIndexer = new CkbIndexer(config.ckb.ckbRpcUrl, config.ckb.ckbIndexerUrl);

    // TODO remove private key in ForceBridgeCore
    ForceBridgeCore.config.ckb.fromPrivateKey = keystore.getDecryptedByKeyID('ckb');
    ForceBridgeCore.config.eth.privateKey = keystore.getDecryptedByKeyID('eth');
    return this;
  }
}
