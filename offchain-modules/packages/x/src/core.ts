import fs from 'fs';
import { KeyStore } from '@force-bridge/keystore';
import CKB from '@nervosnetwork/ckb-sdk-core';
import nconf from 'nconf';
import { CkbIndexer } from './ckb/tx-helper/indexer';
import { Config } from './config';
import { asserts } from './errors';
import { initLog } from './utils/logger';

interface DepCellInfo {
  hashType: CKBComponents.ScriptHashType;
  codeHash: CKBComponents.Hash256;
  typeHash?: CKBComponents.Hash256;
  outPoint: CKBComponents.OutPoint;
  depType: CKBComponents.DepType;
}

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
  private static _secp256k1Dep: DepCellInfo;

  static get config(): Config {
    asserts(ForceBridgeCore._config, 'ForceBridgeCore config is not init yet');
    return ForceBridgeCore._config;
  }

  static get ckb(): CKB {
    asserts(ForceBridgeCore._ckb, 'ForceBridgeCore ckb is not init yet');
    return ForceBridgeCore._ckb;
  }

  static get ckbIndexer(): CkbIndexer {
    asserts(ForceBridgeCore._ckbIndexer, 'ForceBridgeCore ckbIndexer is not init yet');
    return ForceBridgeCore._ckbIndexer;
  }

  static get keystore(): KeyStore {
    asserts(ForceBridgeCore._keystore, 'ForceBridgeCore keystore is not init yet');
    return ForceBridgeCore._keystore;
  }

  static get secp256k1Dep(): DepCellInfo {
    asserts(ForceBridgeCore._secp256k1Dep, 'ForceBridgeCore secp256k1Dep is not init yet');
    return ForceBridgeCore._secp256k1Dep;
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
    const { secp256k1Dep } = await ForceBridgeCore._ckb.loadDeps();
    asserts(secp256k1Dep);
    ForceBridgeCore._secp256k1Dep = secp256k1Dep;
    ForceBridgeCore._ckbIndexer = new CkbIndexer(config.ckb.ckbRpcUrl, config.ckb.ckbIndexerUrl);
    ForceBridgeCore._config = config;
    ForceBridgeCore._keystore = keystore;
    return this;
  }
}
