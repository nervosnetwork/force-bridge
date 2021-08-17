import fs from 'fs';
import path from 'path';
import { KeyStore } from '@force-bridge/keystore/dist';
import { OwnerCellConfig } from '@force-bridge/x/dist/ckb/tx-helper/deploy';
import { Config, WhiteListEthAsset, CkbDeps } from '@force-bridge/x/dist/config';
import { privateKeyToCkbPubkeyHash, writeJsonToFile } from '@force-bridge/x/dist/utils';
import { logger, initLog } from '@force-bridge/x/dist/utils/logger';
import * as lodash from 'lodash';
import * as Mustache from 'mustache';
import { execShellCmd, PATH_PROJECT_ROOT, pathFromProjectRoot } from './utils';
import { deployDev } from './utils/deploy';

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
) {
  const baseConfig: Config = lodash.cloneDeep(initConfig);
  logger.debug(`baseConfig: ${JSON.stringify(baseConfig, null, 2)}`);
  baseConfig.eth.assetWhiteList = assetWhiteList;
  baseConfig.eth.contractAddress = ethContractAddress;
  baseConfig.ckb.deps = ckbDeps;
  baseConfig.ckb.startBlockHeight = ckbStartHeight;
  baseConfig.eth.startBlockHeight = ethStartHeight;
  baseConfig.ckb.ownerCellTypescript = ownerCellConfig.ownerCellTypescript;
  // collector
  const collectorConfig: Config = lodash.cloneDeep(baseConfig);
  collectorConfig.common.role = 'collector';
  collectorConfig.common.log.level = 'debug';
  collectorConfig.common.orm!.host = 'collector_db';
  collectorConfig.common.collectorPubKeyHash.push(privateKeyToCkbPubkeyHash(CKB_PRIVATE_KEY));
  collectorConfig.eth.privateKey = 'eth';
  collectorConfig.ckb.privateKey = 'ckb';
  collectorConfig.eth.multiSignThreshold = multisigConfig.threshold;
  collectorConfig.eth.multiSignAddresses = multisigConfig.verifiers.map((v) => v.ethAddress);
  collectorConfig.common.keystorePath = '/data/keystore.json';
  collectorConfig.ckb.multisigScript = {
    R: 0,
    M: multisigConfig.threshold,
    publicKeyHashes: multisigConfig.verifiers.map((v) => v.ckbPubkeyHash),
  };
  collectorConfig.collector = {
    gasLimit: 250000,
    batchGasLimit: 100000,
    gasPriceGweiLimit: 100,
  };
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
  // verifiers
  multisigConfig.verifiers.map((v, i) => {
    const verifierIndex = i + 1;
    const verifierConfig: Config = lodash.cloneDeep(baseConfig);
    verifierConfig.common.role = 'verifier';
    verifierConfig.common.orm!.host = `verifier${verifierIndex}_db`;
    verifierConfig.eth.privateKey = 'verifier';
    verifierConfig.ckb.privateKey = 'verifier';
    verifierConfig.common.collectorPubKeyHash.push(privateKeyToCkbPubkeyHash(CKB_PRIVATE_KEY));
    verifierConfig.common.keystorePath = '/data/keystore.json';
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
    networks:
      - {{network}}
    command: |
      sh -c '
      cp /app/devops/devnet-docker/.env.tx_sender.docker /data/.env
      cd /app/offchain-modules;
      yarn startTxSender
      '
  watcher_db:
    image: mysql:5.7
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: forcebridge
    ports:
      - 3299:3306
    networks:
      - {{network}}
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
      - "3199:80"
    command: |
      sh -c '
      cd /app/offchain-modules;
      npx ts-node ./packages/app-cli/src/index.ts rpc -cfg /data/force_bridge.json
      '
    depends_on:
      - watcher_db
    networks:
      - {{network}}
  collector_db:
    image: mysql:5.7
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: forcebridge
    ports:
      - 3298:3306
    networks:
      - {{network}}
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
      - "3198:80"
    command: |
      sh -c '
      cd /app/offchain-modules;
      npx ts-node ./packages/app-cli/src/index.ts collector -cfg /data/force_bridge.json
      '
    depends_on:
      - collector_db
    networks:
      - {{network}}
{{#verifiers}}      
  {{name}}_db:
    image: mysql:5.7
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: forcebridge
    ports:
      - {{db_port}}:3306
    networks:
      - {{network}}
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
    networks:
      - {{network}}
{{/verifiers}}      
volumes:
  force-bridge-node-modules:
    external: true
networks:
  {{network}}:
    external: true
`;

async function main() {
  initLog({ level: 'debug', identity: 'dev-docker' });
  // used for deploy and run service
  const ETH_PRIVATE_KEY = '0xc4ad657963930fbff2e9de3404b30a4e21432c89952ed430b56bf802945ed37a';
  const CKB_PRIVATE_KEY = '0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe';

  const MULTISIG_NUMBER = 3;
  const MULTISIG_THRESHOLD = 3;
  const FORCE_BRIDGE_KEYSTORE_PASSWORD = '123456';
  const ETH_RPC_URL = 'http://127.0.0.1:3000';
  const CKB_RPC_URL = 'http://127.0.0.1:3001';
  const CKB_INDEXER_URL = 'http://127.0.0.1:3002';

  const configPath = pathFromProjectRoot('workdir/dev-docker');
  const offchainModulePath = pathFromProjectRoot('offchain-modules');

  const initConfig = {
    common: {
      log: {
        level: 'info',
        logFile: '/data/force_bridge.log',
      },
      lumosConfigType: 'DEV',
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
      rpcUrl: 'http://10.4.0.10:8545',
      confirmNumber: 12,
      startBlockHeight: 1,
      batchUnlock: {
        batchNumber: 100,
        maxWaitTime: 86400000,
      },
    },
    ckb: {
      ckbRpcUrl: 'http://ckb-dev:8114',
      ckbIndexerUrl: 'http://ckb-indexer-dev:8116',
      startBlockHeight: 1,
      confirmNumber: 15,
      sudtSize: 500,
    },
  };
  const { assetWhiteList, ckbDeps, ownerConfig, bridgeEthAddress, multisigConfig, ckbStartHeight, ethStartHeight } =
    await deployDev(
      ETH_RPC_URL,
      CKB_RPC_URL,
      CKB_INDEXER_URL,
      MULTISIG_NUMBER,
      MULTISIG_THRESHOLD,
      ETH_PRIVATE_KEY,
      CKB_PRIVATE_KEY,
      'DEV',
      path.join(configPath, 'deployConfig.json'),
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
  );

  const verifiers = lodash.range(MULTISIG_NUMBER).map((i) => {
    return {
      name: `verifier${i + 1}`,
      db_port: 3200 + i,
      port: 3100 + i,
    };
  });
  const dockerComposeFile = Mustache.render(dockerComposeTemplate, {
    FORCE_BRIDGE_KEYSTORE_PASSWORD,
    network: 'docker_force-dev-net',
    projectDir: PATH_PROJECT_ROOT,
    verifiers,
  });
  fs.writeFileSync(path.join(configPath, 'docker-compose.yml'), dockerComposeFile);
  await execShellCmd(
    `docker run --rm -v ${offchainModulePath}:/app -v force-bridge-node-modules:/app/node_modules node:14 bash -c 'cd /app && yarn build'`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error(`integration test failed, error: ${error.stack}`);
    process.exit(1);
  });
