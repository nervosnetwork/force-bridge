import fs from 'fs';
import path from 'path';
import { KeyStore } from '@force-bridge/keystore/dist';
import { OwnerCellConfig } from '@force-bridge/x/dist/ckb/tx-helper/deploy';
import { Config, WhiteListEthAsset, CkbDeps } from '@force-bridge/x/dist/config';
import { getFromEnv, privateKeyToCkbPubkeyHash, writeJsonToFile } from '@force-bridge/x/dist/utils';
import { logger, initLog } from '@force-bridge/x/dist/utils/logger';
import * as dotenv from 'dotenv';
import * as lodash from 'lodash';
import * as Mustache from 'mustache';
import { execShellCmd, PATH_PROJECT_ROOT, pathFromProjectRoot } from './utils';
import { deployDev } from './utils/deploy';
dotenv.config({ path: process.env.DOTENV_PATH || '.env' });

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
  ETH_PRIVATE_KEY: string,
  CKB_PRIVATE_KEY: string,
  password,
  monitorDiscordWebHook: string,
) {
  const baseConfig: Config = lodash.cloneDeep(initConfig);
  logger.debug(`baseConfig: ${JSON.stringify(baseConfig, null, 2)}`);
  baseConfig.eth.assetWhiteList = assetWhiteList;
  baseConfig.eth.contractAddress = ethContractAddress;
  baseConfig.ckb.deps = ckbDeps;
  baseConfig.ckb.ownerCellTypescript = ownerCellConfig.ownerCellTypescript;
  baseConfig.ckb.startBlockHeight = ckbStartHeight;
  baseConfig.eth.startBlockHeight = ethStartHeight;
  // collector
  const collectorConfig: Config = lodash.cloneDeep(baseConfig);
  collectorConfig.common.role = 'collector';
  collectorConfig.common.orm!.host = 'collector_db';
  collectorConfig.common.keystorePath = '/data/keystore.json';
  collectorConfig.eth.privateKey = 'eth';
  collectorConfig.ckb.privateKey = 'ckb';
  collectorConfig.eth.multiSignThreshold = multisigConfig.threshold;
  collectorConfig.eth.multiSignAddresses = multisigConfig.verifiers.map((v) => v.ethAddress);
  collectorConfig.ckb.multisigScript = {
    R: 0,
    M: multisigConfig.threshold,
    publicKeyHashes: multisigConfig.verifiers.map((v) => v.ckbPubkeyHash),
  };
  collectorConfig.collector = {
    gasLimit: 250000,
    batchGasLimit: 120000,
    gasPriceGweiLimit: 100,
  };
  collectorConfig.common.collectorPubKeyHash.push(privateKeyToCkbPubkeyHash(CKB_PRIVATE_KEY));
  collectorConfig.eth.multiSignHosts = multisigConfig.verifiers.map((v, i) => {
    return {
      address: v.ethAddress,
      host: `http://verifier${i + 1}/force-bridge/sign-server/api/v1`,
    };
  });
  collectorConfig.ckb.multiSignHosts = multisigConfig.verifiers.map((v, i) => {
    return {
      address: v.ckbAddress,
      host: `http://verifier${i + 1}/force-bridge/sign-server/api/v1`,
    };
  });
  const collectorStore = KeyStore.createFromPairs(
    {
      ckb: CKB_PRIVATE_KEY,
      eth: ETH_PRIVATE_KEY,
    },
    password,
  ).getEncryptedData();
  const collectorKeystorePath = path.join(configPath, 'collector/keystore.json');
  writeJsonToFile(collectorStore, collectorKeystorePath);
  writeJsonToFile({ forceBridge: collectorConfig }, path.join(configPath, 'collector/force_bridge.json'));
  // watcher
  const watcherConfig: Config = lodash.cloneDeep(baseConfig);
  watcherConfig.common.role = 'watcher';
  watcherConfig.common.orm!.host = 'watcher_db';
  writeJsonToFile({ forceBridge: watcherConfig }, path.join(configPath, 'watcher/force_bridge.json'));
  //monitor
  const monitorConfig: Config = lodash.cloneDeep(baseConfig);
  monitorConfig.common.orm = undefined;
  monitorConfig.common.port = undefined;
  monitorConfig.common.openMetric = false;
  monitorConfig.common.role = 'watcher';
  monitorConfig.common.log.identity = 'monitor';
  monitorConfig.common.log.logFile = path.join(configPath, 'monitor/force_bridge.log');
  monitorConfig.monitor = {
    discordWebHook: monitorDiscordWebHook,
    expiredTime: 1800000, //30 minutes
    expiredCheckInterval: 900000, //15 minutes
    scanStep: 100,
    env: 'testnet-docker',
  };
  writeJsonToFile({ forceBridge: monitorConfig }, path.join(configPath, 'monitor/force_bridge.json'));
  // verifiers
  multisigConfig.verifiers.map((v, i) => {
    const verifierIndex = i + 1;
    const verifierConfig: Config = lodash.cloneDeep(baseConfig);
    verifierConfig.common.role = 'verifier';
    verifierConfig.common.orm!.host = `verifier${verifierIndex}_db`;
    verifierConfig.common.keystorePath = '/data/keystore.json';
    verifierConfig.eth.privateKey = 'verifier';
    verifierConfig.ckb.privateKey = 'verifier';
    verifierConfig.common.collectorPubKeyHash.push(privateKeyToCkbPubkeyHash(CKB_PRIVATE_KEY));
    const verifierStore = KeyStore.createFromPairs(
      {
        verifier: v.privkey,
      },
      password,
    ).getEncryptedData();
    const verifierKeystorePath = path.join(configPath, `verifier${verifierIndex}/keystore.json`);
    writeJsonToFile(verifierStore, verifierKeystorePath);
    writeJsonToFile(
      { forceBridge: verifierConfig },
      path.join(configPath, `verifier${verifierIndex}/force_bridge.json`),
    );
  });
  // docker compose file
}

const dockerComposeTemplate = `
version: "3.3"
services:
  script:
    image: node:14
    restart: on-failure
    volumes:
      - ./script:/data
      - {{&projectDir}}:/app
      - force-bridge-node-modules:/app/offchain-modules/node_modules
    environment:
      DOTENV_PATH: /data/.env
      LOG_PATH: /data/script.log
    command: |
      sh -c '
      cp /app/workdir/testnet-docker/.env.tx_sender /data/.env
      cd /app/offchain-modules;
      yarn startTxSender
      '
  watcher_db:
    image: mysql:5.7
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: forcebridge
    ports:
      - 3050:3306
  watcher:
    image: node:14
    restart: on-failure
    environment:
      FORCE_BRIDGE_KEYSTORE_PASSWORD: {{FORCE_BRIDGE_KEYSTORE_PASSWORD}}
    volumes:
      - {{&projectDir}}:/app
      - force-bridge-node-modules:/app/offchain-modules/node_modules
      - ./watcher:/data
    ports:
      - "3060:80"
    command: |
      sh -c '
      cd /app/offchain-modules;
      npx ts-node ./packages/app-cli/src/index.ts rpc -cfg /data/force_bridge.json
      '
    depends_on:
      - watcher_db
  collector_db:
    image: mysql:5.7
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: forcebridge
    ports:
      - 3059:3306
  collector:
    image: node:14
    restart: on-failure
    environment:
      FORCE_BRIDGE_KEYSTORE_PASSWORD: {{FORCE_BRIDGE_KEYSTORE_PASSWORD}}
    volumes:
      - {{&projectDir}}:/app
      - force-bridge-node-modules:/app/offchain-modules/node_modules
      - ./collector:/data
    ports:
      - "3069:80"
    command: |
      sh -c '
      cd /app/offchain-modules;
      npx ts-node ./packages/app-cli/src/index.ts collector -cfg /data/force_bridge.json
      '
    depends_on:
      - collector_db
{{#verifiers}}      
  {{name}}_db:
    image: mysql:5.7
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: forcebridge
    ports:
      - {{db_port}}:3306
  {{name}}:
    image: node:14
    restart: on-failure
    environment:
      FORCE_BRIDGE_KEYSTORE_PASSWORD: {{FORCE_BRIDGE_KEYSTORE_PASSWORD}}
    volumes:
      - {{&projectDir}}:/app
      - force-bridge-node-modules:/app/offchain-modules/node_modules
      - ./{{name}}:/data
    ports:
      - {{port}}:80
    command: |
      sh -c '
      cd /app/offchain-modules;
      npx ts-node ./packages/app-cli/src/index.ts verifier -cfg /data/force_bridge.json
      '
    depends_on:
      - {{name}}_db
{{/verifiers}}
  monitor:
    image: node:14
    restart: on-failure
    environment:
      MONITOR_DURATION_CONFIG_PATH: /data/monitor.json
    volumes:
      - {{&projectDir}}:/app
      - force-bridge-node-modules:/app/offchain-modules/node_modules
      - ./monitor:/data
    command: |
      sh -c '
      cd /app/offchain-modules;
      npx ts-node ./packages/app-cli/src/index.ts monitor -cfg /data/force_bridge.json
      '
volumes:
  force-bridge-node-modules:
    external: true
`;

async function main() {
  initLog({ level: 'debug', identity: 'testnet-docker' });
  // used for deploy and run service
  const CKB_RPC_URL = getFromEnv('CKB_RPC_URL');
  const ETH_RPC_URL = getFromEnv('ETH_RPC_URL');
  const CKB_INDEXER_URL = getFromEnv('CKB_INDEXER_URL');
  const CKB_PRIVATE_KEY = getFromEnv('CKB_PRIVATE_KEY');
  const ETH_PRIVATE_KEY = getFromEnv('ETH_PRIVATE_KEY');
  const MONITOR_DISCORD_WEBHOOK = getFromEnv('MONITOR_DISCORD_WEBHOOK');

  const MULTISIG_NUMBER = 3;
  const MULTISIG_THRESHOLD = 3;
  const FORCE_BRIDGE_KEYSTORE_PASSWORD = '123456';

  const configPath = pathFromProjectRoot('workdir/testnet-docker');

  const initConfig = {
    common: {
      log: {
        level: 'info',
        logFile: '/data/force_bridge.log',
      },
      lumosConfigType: 'AGGRON4',
      network: 'testnet',
      role: 'watcher',
      orm: {
        type: 'mysql',
        host: 'db',
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
      port: 80,
    },
    eth: {
      rpcUrl: ETH_RPC_URL,
      confirmNumber: 12,
      startBlockHeight: 1,
      batchUnlock: {
        batchNumber: 100,
        maxWaitTime: 86400000,
      },
    },
    ckb: {
      ckbRpcUrl: CKB_RPC_URL,
      ckbIndexerUrl: CKB_INDEXER_URL,
      startBlockHeight: 1,
      confirmNumber: 15,
      sudtSize: 150,
    },
  };

  let ckbDepsFromFile = undefined;
  const ckbDepsPath = path.join(configPath, 'ckbDeps.json');
  if (fs.existsSync(ckbDepsPath)) {
    ckbDepsFromFile = JSON.parse(fs.readFileSync(ckbDepsPath, 'utf8'));
  }

  const { assetWhiteList, ckbDeps, ownerConfig, bridgeEthAddress, multisigConfig, ckbStartHeight, ethStartHeight } =
    await deployDev(
      ETH_RPC_URL,
      CKB_RPC_URL,
      CKB_INDEXER_URL,
      MULTISIG_NUMBER,
      MULTISIG_THRESHOLD,
      ETH_PRIVATE_KEY,
      CKB_PRIVATE_KEY,
      'AGGRON4',
      path.join(configPath, 'deployConfig.json'),
      ckbDepsFromFile,
    );
  await generateConfig(
    initConfig as unknown as Config,
    assetWhiteList,
    ckbDeps,
    ownerConfig,
    bridgeEthAddress,
    multisigConfig,
    ckbStartHeight,
    ethStartHeight,
    configPath,
    ETH_PRIVATE_KEY,
    CKB_PRIVATE_KEY,
    FORCE_BRIDGE_KEYSTORE_PASSWORD,
    MONITOR_DISCORD_WEBHOOK,
  );

  const verifiers = lodash.range(MULTISIG_NUMBER).map((i) => {
    return {
      name: `verifier${i + 1}`,
      db_port: 3050 + i + 1,
      port: 3060 + i + 1,
    };
  });
  await execShellCmd(`mkdir -p ${path.join(configPath, 'script')}`);
  const dockerComposeFile = Mustache.render(dockerComposeTemplate, {
    FORCE_BRIDGE_KEYSTORE_PASSWORD,
    projectDir: PATH_PROJECT_ROOT,
    verifiers,
  });
  fs.writeFileSync(path.join(configPath, 'docker-compose.yml'), dockerComposeFile);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error(`generate testnet docker config failed, error: ${error.stack}`);
    process.exit(1);
  });
