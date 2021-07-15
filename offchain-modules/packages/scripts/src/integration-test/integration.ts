import { promises as fs } from 'fs';
import path from 'path';
import { KeyStore } from '@force-bridge/keystore/dist';
import { CkbDeployManager, OwnerCellConfig } from '@force-bridge/x/dist/ckb/tx-helper/deploy';
import { initLumosConfig } from '@force-bridge/x/dist/ckb/tx-helper/init_lumos_config';
import { Config, WhiteListEthAsset, CkbDeps, ConfigItem } from '@force-bridge/x/dist/config';
import { asyncSleep, privateKeyToCkbPubkeyHash, writeJsonToFile } from '@force-bridge/x/dist/utils';
import { logger, initLog } from '@force-bridge/x/dist/utils/logger';
import { deployEthContract } from '@force-bridge/x/dist/xchain/eth';
import * as lodash from 'lodash';
import * as shelljs from 'shelljs';

import { keystorePath, verifierServerBasePort } from '../types';
import { pathFromProjectRoot } from '../utils';
import { genRandomVerifierConfig } from './generate';

const ETH_PRIVATE_KEY = '0xc4ad657963930fbff2e9de3404b30a4e21432c89952ed430b56bf802945ed37a';
const CKB_PRIVATE_KEY = '0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe';

export interface VerifierConfig {
  privkey: string;
  ckbAddress: string;
  ckbPubkeyHash: string;
  ethAddress: string;
}

export interface MultisigConfig {
  threshold: number;
  verifiers: VerifierConfig[];
}

async function generateConfig(
  initConfig: Config,
  assetWhiteList: WhiteListEthAsset[],
  ckbDeps: CkbDeps,
  ownerCellConfig: OwnerCellConfig,
  ethContractAddress: string,
  multisigConfig: MultisigConfig,
  ckbStartHeight: number,
  ethStartHeight: number,
  configPath: string,
  password = '123456',
) {
  const baseConfig: Config = lodash.cloneDeep(initConfig);
  logger.debug(`baseConfig: ${JSON.stringify(baseConfig, null, 2)}`);
  baseConfig.eth.assetWhiteList = assetWhiteList;
  baseConfig.eth.contractAddress = ethContractAddress;
  baseConfig.eth.multiSignThreshold = multisigConfig.threshold;
  baseConfig.eth.multiSignAddresses = multisigConfig.verifiers.map((v) => v.ethAddress);
  baseConfig.ckb.deps = ckbDeps;
  baseConfig.ckb.multisigScript = {
    R: 0,
    M: multisigConfig.threshold,
    publicKeyHashes: multisigConfig.verifiers.map((v) => v.ckbPubkeyHash),
  };
  baseConfig.ckb.ownerCellTypescript = ownerCellConfig.ownerCellTypescript;
  baseConfig.ckb.multisigLockscript = ownerCellConfig.multisigLockscript;
  baseConfig.ckb.startBlockHeight = ckbStartHeight;
  baseConfig.eth.startBlockHeight = ethStartHeight;
  // collector
  const collectorConfig: Config = lodash.cloneDeep(baseConfig);
  collectorConfig.common.role = 'collector';
  collectorConfig.common.orm.database = 'collector';
  collectorConfig.common.port = 8090;
  collectorConfig.eth.multiSignHosts = multisigConfig.verifiers.map((v, i) => {
    return {
      address: v.ethAddress,
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
  collectorConfig.common.keystorePath = path.join(configPath, 'collector/keystore.json');
  const collectorStore = KeyStore.createFromPairs(
    {
      ckb: CKB_PRIVATE_KEY,
      eth: ETH_PRIVATE_KEY,
    },
    password,
  ).getEncryptedData();
  writeJsonToFile(collectorStore, collectorConfig.common.keystorePath);
  writeJsonToFile({ forceBridge: collectorConfig }, path.join(configPath, 'collector/force_bridge.json'));
  // watcher
  const watcherConfig: Config = lodash.cloneDeep(baseConfig);
  watcherConfig.common.role = 'watcher';
  watcherConfig.common.orm.database = 'watcher';
  watcherConfig.common.log.logFile = path.join(configPath, 'watcher/force_bridge.log');
  watcherConfig.common.port = 8080;
  watcherConfig.common.keystorePath = path.join(configPath, 'watcher/keystore.json');
  const watcherStore = KeyStore.createFromPairs(
    {
      ckb: CKB_PRIVATE_KEY,
      eth: ETH_PRIVATE_KEY,
    },
    password,
  ).getEncryptedData();
  writeJsonToFile(watcherStore, watcherConfig.common.keystorePath);
  writeJsonToFile({ forceBridge: watcherConfig }, path.join(configPath, 'watcher/force_bridge.json'));
  // verifiers
  multisigConfig.verifiers.map((v, i) => {
    const verifierIndex = i + 1;
    const verifierConfig: Config = lodash.cloneDeep(baseConfig);
    verifierConfig.common.role = 'verifier';
    verifierConfig.common.orm.database = `verifier${verifierIndex}`;
    verifierConfig.eth.privateKey = 'verifier';
    verifierConfig.ckb.privateKey = 'verifier';
    verifierConfig.common.port = 8000 + verifierIndex;
    verifierConfig.common.collectorPubKeyHash.push(privateKeyToCkbPubkeyHash(CKB_PRIVATE_KEY));
    verifierConfig.common.log.logFile = path.join(configPath, `verifier${verifierIndex}/force_bridge.log`);
    verifierConfig.common.keystorePath = path.join(configPath, `verifier${verifierIndex}/keystore.json`);
    const verifierStore = KeyStore.createFromPairs(
      {
        verifier: v.privkey,
      },
      password,
    ).getEncryptedData();
    writeJsonToFile(verifierStore, verifierConfig.common.keystorePath);
    writeJsonToFile(
      { forceBridge: verifierConfig },
      path.join(configPath, `verifier${verifierIndex}/force_bridge.json`),
    );
  });
  // docker compose file
}

async function main() {
  initLog({ level: 'debug' });
  logger.info('start integration test');
  initLumosConfig();
  // const
  const initConfig = {
    common: {
      log: {
        level: 'debug',
      },
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
    eth: {
      rpcUrl: 'http://127.0.0.1:8545',
      privateKey: 'eth',
      confirmNumber: 1,
      startBlockHeight: 1,
      batchUnlock: {
        batchNumber: 100,
        maxWaitTime: 86400000,
      },
    },
    ckb: {
      ckbRpcUrl: 'http://127.0.0.1:8114',
      ckbIndexerUrl: 'http://127.0.0.1:8116',
      privateKey: 'ckb',
      startBlockHeight: 1,
      confirmNumber: 1,
    },
    rpc: {
      port: 8080,
      corsOptions: {
        origin: '*',
        methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
        preflightContinue: false,
        optionsSuccessStatus: 200,
      },
    },
  };
  const multisigNumber = 5;
  const multisigThreshold = 3;
  const verifierConfigs = lodash.range(multisigNumber).map((i) => genRandomVerifierConfig());
  const ethMultiSignAddresses = verifierConfigs.map((vc) => vc.ethAddress);
  const ethRpcUrl = 'http://127.0.0.1:8545';
  const ckbRpcUrl = 'http://127.0.0.1:8114';
  const ckbIndexerUrl = 'http://127.0.0.1:8116';

  // deploy eth contract
  const bridgeEthAddress = await deployEthContract(
    ethRpcUrl,
    ETH_PRIVATE_KEY,
    ethMultiSignAddresses,
    multisigThreshold,
  );
  logger.info(`bridge address: ${bridgeEthAddress}`);
  // deploy ckb contracts
  const PATH_SUDT_DEP = pathFromProjectRoot('/offchain-modules/deps/simple_udt');
  const PATH_RECIPIENT_TYPESCRIPT = pathFromProjectRoot('/ckb-contracts/build/release/recipient-typescript');
  const PATH_BRIDGE_LOCKSCRIPT = pathFromProjectRoot('/ckb-contracts/build/release/bridge-lockscript');
  const ckbDeployGenerator = new CkbDeployManager(ckbRpcUrl, ckbIndexerUrl);
  const contractsDeps = await ckbDeployGenerator.deployContracts(
    {
      bridgeLockscript: await fs.readFile(PATH_BRIDGE_LOCKSCRIPT),
      recipientTypescript: await fs.readFile(PATH_RECIPIENT_TYPESCRIPT),
    },
    CKB_PRIVATE_KEY,
  );
  const sudtBin = await fs.readFile(PATH_SUDT_DEP);
  const sudtDep = await ckbDeployGenerator.deploySudt(sudtBin, CKB_PRIVATE_KEY);
  logger.info('deps', { contractsDeps, sudtDep });
  const multisigItem = {
    R: 0,
    M: multisigThreshold,
    publicKeyHashes: verifierConfigs.map((vc) => vc.ckbPubkeyHash),
  };
  const ownerConfig: OwnerCellConfig = await ckbDeployGenerator.createOwnerCell(multisigItem, CKB_PRIVATE_KEY);
  logger.info('ownerConfig', ownerConfig);
  // generate_configs
  const assetWhiteList: WhiteListEthAsset[] = JSON.parse(
    (await fs.readFile(pathFromProjectRoot('/configs/testnet-asset-white-list.json'), 'utf8')).toString(),
  );
  const ckbDeps = {
    sudtType: sudtDep,
    ...contractsDeps,
  };
  const configPath = pathFromProjectRoot('workdir/integration-docker');
  const multisigConfig = {
    threshold: multisigThreshold,
    verifiers: verifierConfigs,
  };
  await generateConfig(
    initConfig as unknown as Config,
    assetWhiteList,
    ckbDeps,
    ownerConfig,
    bridgeEthAddress,
    multisigConfig,
    1,
    1,
    configPath,
  );

  // create_db
  // start_service
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error(`integration test failed, error: ${error.stack}`);
    process.exit(1);
  });
