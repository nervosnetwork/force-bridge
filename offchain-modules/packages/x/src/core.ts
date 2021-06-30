import fs from 'fs';
import { KeyStore } from '@force-bridge/keystore';
import CKB from '@nervosnetwork/ckb-sdk-core';
import { has } from 'lodash';
import nconf from 'nconf';
import { CkbIndexer } from './ckb/tx-helper/indexer';
import { Config } from './config';
import { asserts } from './errors';
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
  public static initiated: boolean = false;
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
    ForceBridgeCore.initiated = true;
    ForceBridgeCore._config = config;
    ForceBridgeCore._ckb = new CKB(config.ckb.ckbRpcUrl);
    ForceBridgeCore._ckbIndexer = new CkbIndexer(config.ckb.ckbRpcUrl, config.ckb.ckbIndexerUrl);

    // init log
    initLog(config.common.log);

    // decrypt private key
    const keystore = bootstrapKeyStore(config.common.keystorePath);
    // ForceBridgeCore._keystore = keystore;
    ForceBridgeCore.config.ckb.fromPrivateKey = keystore.getDecryptedByKeyID(config.ckb.fromPrivateKey);
    if (config.ckb.multiSignKeys !== undefined) {
      ForceBridgeCore.config.ckb.multiSignKeys = config.ckb.multiSignKeys.map((v) => {
        return {
          address: v.address,
          privKey: keystore.getDecryptedByKeyID(v.privKey),
        };
      });
    }
    if (config.eth !== undefined) {
      ForceBridgeCore.config.eth.privateKey = keystore.getDecryptedByKeyID(config.eth.privateKey);
      if (config.eth.multiSignKeys !== undefined) {
        ForceBridgeCore.config.eth.multiSignKeys = config.eth.multiSignKeys.map((v) => {
          return {
            address: v.address,
            privKey: keystore.getDecryptedByKeyID(v.privKey),
          };
        });
      }
    }
    return this;
  }
}
