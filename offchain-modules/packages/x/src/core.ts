import fs from 'fs';
import { utils } from '@ckb-lumos/base';
import { KeyStore } from '@force-bridge/keystore';
import CKB from '@nervosnetwork/ckb-sdk-core';
import { ethers } from 'ethers';
import nconf from 'nconf';
import { CkbIndexer } from './ckb/tx-helper/indexer';
import { initLumosConfig } from './ckb/tx-helper/init_lumos_config';
import { getSmtRootAndProof } from './ckb/tx-helper/omni-smt';
import { CKB_TYPESCRIPT_HASH, Config } from './config';
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

export class XChainHandlers {
  public ckb: XChainHandler;
  public eth?: XChainHandler;
  public btc?: XChainHandler;
  public eos?: XChainHandler;
  public tron?: XChainHandler;
}

export interface XChainHandler {
  getHandledBlock(): { height: number; hash: string };

  getTipBlock(): Promise<{ height: number; hash: string }>;

  checkBlockSync?(): Promise<boolean>;
}

// make global config and var static,
// which can be import from ForceBridgeCore
export class ForceBridgeCore {
  public static initiated = false;
  private static _config: Config;
  private static _ckb: CKB;
  private static _ckbIndexer: CkbIndexer;
  private static _keystore: KeyStore;
  private static _xChainHandler: XChainHandlers;
  private static _smtProof: string;

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

  static getXChainHandler(): XChainHandlers {
    asserts(ForceBridgeCore._xChainHandler, 'ForceBridgeCore xChainHandler is not init yet');
    return ForceBridgeCore._xChainHandler;
  }

  static getSmtProof(): string {
    asserts(ForceBridgeCore._smtProof, 'ForceBridgeCore SmtProof is not init yet');
    return ForceBridgeCore._smtProof;
  }

  /**
   * @deprecated migrate to {@link bootstrap}
   */
  constructor() {
    // TODO make constructor to be private
  }

  async init(config: Config): Promise<ForceBridgeCore> {
    checkConfigEthereumAddress(config);

    // init log
    initLog(config.common.log);

    // init lumos config
    initLumosConfig(config.common.lumosConfigType);

    if (config.eth && config.eth.nervosAssetWhiteList) {
      const sudtTypescript = config.ckb.deps.sudtType.script;
      config.eth.nervosAssetWhiteList
        .filter((asset) => asset.typescriptHash !== CKB_TYPESCRIPT_HASH && asset.sudtArgs)
        .map((asset) => {
          const typescriptHash = utils.computeScriptHash({
            code_hash: sudtTypescript.codeHash,
            hash_type: sudtTypescript.hashType,
            args: asset.sudtArgs!,
          });
          if (!asset.typescriptHash || asset.typescriptHash !== typescriptHash) {
            throw new Error(
              `invalid nervos asset white list typescriptHash, asset: ${JSON.stringify(
                asset,
              )} typescriptHash: ${typescriptHash}`,
            );
          }
        });
    }

    // set server port
    if (config.common.port) {
      ServerSingleton.getInstance().start(config.common.port);
    }
    // decrypt private key
    let keystore;
    if (config.common.role != 'watcher') {
      keystore = bootstrapKeyStore(config.common.keystorePath);
      if (config.ckb.privateKey) {
        config.ckb.privateKey = keystore.getDecryptedByKeyID(config.ckb.privateKey);
      }
      if (config.eth && config.eth.privateKey) {
        config.eth.privateKey = keystore.getDecryptedByKeyID(config.eth.privateKey);
      }
    }

    if (config.common.role === 'collector') {
      const { proof } = getSmtRootAndProof(config.ckb.multisigScript);
      ForceBridgeCore._smtProof = proof;
    }

    // write static
    ForceBridgeCore.initiated = true;
    ForceBridgeCore._ckb = new CKB(config.ckb.ckbRpcUrl);
    ForceBridgeCore._ckbIndexer = new CkbIndexer(config.ckb.ckbRpcUrl, config.ckb.ckbIndexerUrl);
    ForceBridgeCore._config = config;
    ForceBridgeCore._keystore = keystore;
    ForceBridgeCore._xChainHandler = new XChainHandlers();
    return this;
  }
}

function checkConfigEthereumAddress(config: Config) {
  const verifyChecksumAddress = (addresses: string[]) => {
    addresses.forEach((address) => {
      if (ethers.utils.getAddress(address) !== address)
        throw new Error(`${address} is not a ethereum checksum address`);
    });
  };

  if (config.eth.contractAddress) verifyChecksumAddress([config.eth.contractAddress]);
  if (config.eth.multiSignAddresses) verifyChecksumAddress(config.eth.multiSignAddresses);
  if (config.eth.multiSignHosts) verifyChecksumAddress(config.eth.multiSignHosts.map((value) => value.address));
  if (config.eth.assetWhiteList) verifyChecksumAddress(config.eth.assetWhiteList.map((value) => value.address));
  if (config.monitor?.feeAccounts?.ethAddr) verifyChecksumAddress([config.monitor.feeAccounts.ethAddr]);
}
