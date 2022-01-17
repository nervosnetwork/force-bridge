import fs from 'fs';
import path from 'path';
import * as CardanoWasm from '@emurgo/cardano-serialization-lib-nodejs';
import { ValInfos } from '@force-bridge/cli/src/changeVal';
import { KeyStore } from '@force-bridge/keystore/dist';
import { OwnerCellConfig } from '@force-bridge/x/dist/ckb/tx-helper/deploy';
import { AdaConfig, Config, WhiteListEthAsset, CkbDeps } from '@force-bridge/x/dist/config';
import { asyncSleep, privateKeyToCkbPubkeyHash, writeJsonToFile, genRandomHex } from '@force-bridge/x/dist/utils';
import { logger, initLog } from '@force-bridge/x/dist/utils/logger';
import * as utils from '@force-bridge/x/dist/xchain/ada/utils';
import { AdaChain } from '@force-bridge/x/dist/xchain/ada/wallet-interface';
import * as lodash from 'lodash';
import * as shelljs from 'shelljs';
import { handleDb, startVerifierService } from './integration';
import { execShellCmd, pathFromProjectRoot } from './utils';
import { cardanoBatchTest } from './utils/cardano_batch_test';
import { deployDev, genRandomVerifierConfig, AdaVerifierConfig } from './utils/deploy-cardano';

export interface MultisigConfig {
  threshold: number;
  verifiers: AdaVerifierConfig[];
}

async function generateConfig(
  initConfig: Config,
  ckbDeps: CkbDeps,
  ownerCellConfig: OwnerCellConfig,
  multisigConfig: MultisigConfig,
  extraMultiSigConfig: MultisigConfig,
  ckbStartHeight: number,
  adaStartHeight: number,
  configPath: string,
  CKB_PRIVATE_KEY: string,
  password: string,
  sudtSize = 200,
) {
  const baseConfig: Config = lodash.cloneDeep(initConfig);
  logger.debug(`baseConfig: ${JSON.stringify(baseConfig, null, 2)}`);
  baseConfig.ckb.deps = ckbDeps;
  baseConfig.ckb.ownerCellTypescript = ownerCellConfig.ownerCellTypescript;
  baseConfig.ckb.startBlockHeight = ckbStartHeight;
  baseConfig.ada.startBlockHeight = adaStartHeight;
  // collector
  const collectorConfig: Config = lodash.cloneDeep(baseConfig);
  collectorConfig.common.role = 'collector';
  collectorConfig.common.orm!.database = 'collector';
  collectorConfig.common.port = 8090;
  collectorConfig.common.collectorPubKeyHash.push(privateKeyToCkbPubkeyHash(CKB_PRIVATE_KEY));
  collectorConfig.ckb.privateKey = 'ckb';
  collectorConfig.ckb.sudtSize = sudtSize;
  collectorConfig.ckb.multisigScript = {
    R: 0,
    M: multisigConfig.threshold,
    publicKeyHashes: multisigConfig.verifiers.map((v) => v.ckbPubkeyHash),
  };
  collectorConfig.collector = {
    gasLimit: 250000,
    batchGasLimit: 100000,
    gasPriceGweiLimit: 2,
  };
  collectorConfig.ada.multiSignHosts = multisigConfig.verifiers.map((v, i) => {
    return {
      address: v.adaPubkeyHash,
      host: `http://127.0.0.1:${8000 + i + 1}/force-bridge/sign-server/api/v1`,
    };
  });
  collectorConfig.ckb.multiSignHosts = multisigConfig.verifiers.map((v, i) => {
    return {
      address: v.ckbAddress,
      host: `http://127.0.0.1:${8000 + i + 1}/force-bridge/sign-server/api/v1`,
    };
  });
  collectorConfig.common.log.logFile = path.join(configPath, 'collector/force_bridge.log');
  collectorConfig.common.log.identity = 'collector';
  collectorConfig.common.keystorePath = path.join(configPath, 'collector/keystore.json');
  const collectorStore = KeyStore.createFromPairs(
    {
      ckb: CKB_PRIVATE_KEY,
    },
    password,
  ).getEncryptedData();
  writeJsonToFile(collectorStore, collectorConfig.common.keystorePath);
  writeJsonToFile({ forceBridge: collectorConfig }, path.join(configPath, 'collector/force_bridge.json'));
  // watcher
  const watcherConfig: Config = lodash.cloneDeep(baseConfig);
  watcherConfig.common.role = 'watcher';
  watcherConfig.common.orm!.database = 'watcher';
  watcherConfig.common.log.logFile = path.join(configPath, 'watcher/force_bridge.log');
  watcherConfig.common.log.identity = 'watcher';
  watcherConfig.common.port = 8080;
  watcherConfig.ckb.sudtSize = sudtSize;
  writeJsonToFile({ forceBridge: watcherConfig }, path.join(configPath, 'watcher/force_bridge.json'));
  // verifiers
  multisigConfig.verifiers.concat(extraMultiSigConfig.verifiers).map((v, i) => {
    const verifierIndex = i + 1;
    const verifierConfig: Config = lodash.cloneDeep(baseConfig);
    verifierConfig.common.role = 'verifier';
    verifierConfig.common.orm!.database = `verifier${verifierIndex}`;
    verifierConfig.ckb.privateKey = 'verifier';
    verifierConfig.ada.privateKey = v.adaSigningKey;
    verifierConfig.common.port = 8000 + verifierIndex;
    verifierConfig.common.collectorPubKeyHash.push(privateKeyToCkbPubkeyHash(CKB_PRIVATE_KEY));
    verifierConfig.common.log.logFile = path.join(configPath, `verifier${verifierIndex}/force_bridge.log`);
    verifierConfig.common.log.identity = `verifier${verifierIndex}`;
    verifierConfig.common.keystorePath = path.join(configPath, `verifier${verifierIndex}/keystore.json`);
    const verifierStore = KeyStore.createFromPairs(
      {
        verifier: v.privkey,
        ada: v.adaSigningKey,
      },
      password,
    ).getEncryptedData();
    writeJsonToFile(verifierStore, verifierConfig.common.keystorePath);
    writeJsonToFile(
      { forceBridge: verifierConfig },
      path.join(configPath, `verifier${verifierIndex}/force_bridge.json`),
    );
  });
}

function getBridgeAddr(config: MultisigConfig): string {
  const keyHashes: CardanoWasm.Ed25519KeyHash[] = [];
  for (const k of config.verifiers) {
    keyHashes.push(CardanoWasm.Ed25519KeyHash.from_bech32(k.adaPubkeyHash));
  }
  const bridgeMultiSigScript = utils.createMultiSigScript(keyHashes, config.threshold);
  const bridgeMultiSigAddr = utils.getScriptAddress(bridgeMultiSigScript, utils.cardanoTestnetNetworkId());
  return bridgeMultiSigAddr.to_address().to_bech32();
}

async function main() {
  initLog({ level: 'debug', identity: 'integration' });
  logger.info('start integration test');

  // used for deploy and run service
  const CKB_PRIVATE_KEY = '0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe';
  // used for test
  const CKB_TEST_PRIVKEY = '0xa6b8e0cbadda5c0d91cf82d1e8d8120b755aa06bc49030ca6e8392458c65fc80';
  const ADA_TEST_MNEMONIC =
    'surface column cluster fog rely clap small armor horn worry festival dawn chuckle gospel vague melt lift reduce dish razor secret gloom glide correct';

  const MULTISIG_NUMBER = 2;
  const MULTISIG_THRESHOLD = 2;
  const EXTRA_MULTISIG_NUMBER = 3;
  const FORCE_BRIDGE_KEYSTORE_PASSWORD = '123456';
  const CARDANO_WALLET_RPC_URL = 'http://127.0.0.1:8190/v2';
  const CKB_RPC_URL = 'http://127.0.0.1:8114';
  const CKB_INDEXER_URL = 'http://127.0.0.1:8116';
  const FORCE_BRIDGE_URL = 'http://127.0.0.1:8080/force-bridge/api/v1';

  const configPath = pathFromProjectRoot('workdir/integration');
  const offchainModulePath = pathFromProjectRoot('offchain-modules');
  const tsnodePath = path.join(offchainModulePath, 'node_modules/.bin/ts-node');
  const forcecli = `${tsnodePath} ${offchainModulePath}/packages/app-cli/src/index.ts`;

  // TODO fix
  const adaStartHeight = 1;

  const { ckbDeps, ownerConfig, multisigConfig, ckbStartHeight } = await deployDev(
    CKB_RPC_URL,
    CKB_INDEXER_URL,
    MULTISIG_NUMBER,
    MULTISIG_THRESHOLD,
    CKB_PRIVATE_KEY,
    'DEV',
    path.join(configPath, 'deployConfig.json'),
  );
  const extraMultiSigConfig = {
    threshold: EXTRA_MULTISIG_NUMBER,
    verifiers: lodash.range(EXTRA_MULTISIG_NUMBER).map((_i) => genRandomVerifierConfig()),
  };
  const initConfig = {
    common: {
      log: {
        level: 'debug',
      },
      lumosConfigType: 'DEV',
      network: 'testnet',
      role: 'watcher',
      orm: {
        type: 'mysql',
        host: 'localhost',
        port: 3306,
        username: 'root',
        password: 'root',
        database: 'forcebridge',
        timezone: 'Z',
        synchronize: true,
        logging: false,
      },
      openMetric: true,
      collectorPubKeyHash: [],
    },
    ada: {
      walletRpcUrl: CARDANO_WALLET_RPC_URL,
      walletName: 'FORCE_BRIDGE_TEST_INTEG_WALLET' + genRandomHex(16),
      multiSignKeyHashes: multisigConfig.verifiers.map((v) => v.adaPubkeyHash),
      multiSignHosts: [],
      multiSignThreshold: MULTISIG_THRESHOLD,
      confirmNumber: 10,
      startBlockHeight: 1,
      networkId: utils.cardanoTestnetNetworkId(),
    },
    ckb: {
      ckbRpcUrl: 'http://127.0.0.1:8114',
      ckbIndexerUrl: 'http://127.0.0.1:8116',
      startBlockHeight: 1,
      confirmNumber: 1,
    },
  };
  logger.info(`extra multiSig config ${JSON.stringify(extraMultiSigConfig, null, 2)}`);
  await generateConfig(
    initConfig as unknown as Config,
    ckbDeps,
    ownerConfig,
    multisigConfig,
    extraMultiSigConfig,
    ckbStartHeight,
    adaStartHeight,
    configPath,
    CKB_PRIVATE_KEY,
    FORCE_BRIDGE_KEYSTORE_PASSWORD,
  );
  await handleDb('drop', MULTISIG_NUMBER + EXTRA_MULTISIG_NUMBER);
  await handleDb('create', MULTISIG_NUMBER + EXTRA_MULTISIG_NUMBER);
  await asyncSleep(40000);
  await startVerifierService(
    FORCE_BRIDGE_KEYSTORE_PASSWORD,
    forcecli,
    configPath,
    MULTISIG_NUMBER + EXTRA_MULTISIG_NUMBER,
  );

  const command = `FORCE_BRIDGE_KEYSTORE_PASSWORD=${FORCE_BRIDGE_KEYSTORE_PASSWORD} ${forcecli} collector -cfg ${configPath}/collector/force_bridge.json`;
  const collectorProcess = shelljs.exec(command, { async: true });
  await asyncSleep(80000);
  const bridgeMultiSigAddr = getBridgeAddr(multisigConfig);
  await cardanoBatchTest(
    CKB_TEST_PRIVKEY,
    CARDANO_WALLET_RPC_URL,
    CKB_RPC_URL,
    CKB_INDEXER_URL,
    FORCE_BRIDGE_URL,
    bridgeMultiSigAddr,
    ADA_TEST_MNEMONIC,
    3,
  );

  logger.info('integration test pass!');
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error(`integration test failed, error: ${error.stack}`);
    process.exit(1);
  });
