import fs from 'fs';
import path from 'path';
import { ValInfos } from '@force-bridge/cli/src/changeVal';
import { KeyStore } from '@force-bridge/keystore/dist';
import { OwnerCellConfig } from '@force-bridge/x/dist/ckb/tx-helper/deploy';
import { Config, WhiteListEthAsset, CkbDeps } from '@force-bridge/x/dist/config';
import { asyncSleep, privateKeyToCkbPubkeyHash, writeJsonToFile } from '@force-bridge/x/dist/utils';
import { logger, initLog } from '@force-bridge/x/dist/utils/logger';
import * as lodash from 'lodash';
import { execShellCmd, pathFromProjectRoot } from './utils';
import { deployDev } from './utils/deploy';
import { ethBatchTest } from './utils/eth_batch_test';
import { rpcTest } from './utils/rpc-ci';

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

async function handleDb(action: 'create' | 'drop', MULTISIG_NUMBER: number) {
  if (action === 'create') {
    for (let i = 0; i < MULTISIG_NUMBER; i++) {
      await execShellCmd(
        `docker exec docker_mysql_1 bash -c "mysql -uroot -proot -e 'create database verifier${i + 1}'";`,
      );
    }
    await execShellCmd(
      `docker exec docker_mysql_1 bash -c "mysql -uroot -proot -e 'create database collector; create database watcher; show databases;'";`,
    );
  } else {
    for (let i = 0; i < MULTISIG_NUMBER; i++) {
      await execShellCmd(
        `docker exec docker_mysql_1 bash -c "mysql -uroot -proot -e 'drop database if exists verifier${i + 1}'";`,
      );
    }
    await execShellCmd(
      `docker exec docker_mysql_1 bash -c "mysql -uroot -proot -e 'drop database if exists collector; drop database if exists watcher; show databases;'";`,
    );
  }
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
  baseConfig.ckb.ownerCellTypescript = ownerCellConfig.ownerCellTypescript;
  baseConfig.ckb.startBlockHeight = ckbStartHeight;
  baseConfig.eth.startBlockHeight = ethStartHeight;
  // collector
  const collectorConfig: Config = lodash.cloneDeep(baseConfig);
  collectorConfig.common.role = 'collector';
  collectorConfig.common.orm!.database = 'collector';
  collectorConfig.common.port = 8090;
  collectorConfig.common.collectorPubKeyHash.push(privateKeyToCkbPubkeyHash(CKB_PRIVATE_KEY));
  collectorConfig.eth.privateKey = 'eth';
  collectorConfig.ckb.privateKey = 'ckb';
  collectorConfig.eth.multiSignThreshold = multisigConfig.threshold;
  collectorConfig.eth.multiSignAddresses = multisigConfig.verifiers.map((v) => v.ethAddress);
  collectorConfig.ckb.multisigScript = {
    R: 0,
    M: multisigConfig.threshold,
    publicKeyHashes: multisigConfig.verifiers.map((v) => v.ckbPubkeyHash),
  };
  collectorConfig.ckb.multisigLockscript = ownerCellConfig.multisigLockscript;
  collectorConfig.collector = {
    gasLimit: 250000,
    batchGasLimit: 100000,
    gasPriceGweiLimit: 1,
  };
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
  collectorConfig.common.log.identity = 'collector';
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
  watcherConfig.common.orm!.database = 'watcher';
  watcherConfig.common.log.logFile = path.join(configPath, 'watcher/force_bridge.log');
  watcherConfig.common.log.identity = 'watcher';
  watcherConfig.common.port = 8080;
  writeJsonToFile({ forceBridge: watcherConfig }, path.join(configPath, 'watcher/force_bridge.json'));
  // verifiers
  multisigConfig.verifiers.map((v, i) => {
    const verifierIndex = i + 1;
    const verifierConfig: Config = lodash.cloneDeep(baseConfig);
    verifierConfig.common.role = 'verifier';
    verifierConfig.common.orm!.database = `verifier${verifierIndex}`;
    verifierConfig.eth.privateKey = 'verifier';
    verifierConfig.ckb.privateKey = 'verifier';
    verifierConfig.common.port = 8000 + verifierIndex;
    verifierConfig.common.collectorPubKeyHash.push(privateKeyToCkbPubkeyHash(CKB_PRIVATE_KEY));
    verifierConfig.common.log.logFile = path.join(configPath, `verifier${verifierIndex}/force_bridge.log`);
    verifierConfig.common.log.identity = `verifier${verifierIndex}`;
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

async function startVerifierService(
  FORCE_BRIDGE_KEYSTORE_PASSWORD: string,
  forcecli: string,
  configPath: string,
  MULTISIG_NUMBER: number,
) {
  for (let i = 1; i <= MULTISIG_NUMBER; i++) {
    await execShellCmd(
      `FORCE_BRIDGE_KEYSTORE_PASSWORD=${FORCE_BRIDGE_KEYSTORE_PASSWORD} ${forcecli} verifier -cfg ${configPath}/verifier${i}/force_bridge.json`,
      false,
    );
  }
  await execShellCmd(
    `FORCE_BRIDGE_KEYSTORE_PASSWORD=${FORCE_BRIDGE_KEYSTORE_PASSWORD} ${forcecli} rpc -cfg ${path.join(
      configPath,
      'watcher/force_bridge.json',
    )}`,
    false,
  );
}

async function startCollectorService(FORCE_BRIDGE_KEYSTORE_PASSWORD: string, forcecli: string, configPath: string) {
  await execShellCmd(
    `FORCE_BRIDGE_KEYSTORE_PASSWORD=${FORCE_BRIDGE_KEYSTORE_PASSWORD} ${forcecli} collector -cfg ${configPath}/collector/force_bridge.json`,
    false,
  );
}
async function startChangeVal(
  forcecli: string,
  configPath: string,
  bridgeEthAddress: string,
  CKB_PRIVKEY: string,
  ETH_PRIVKEY: string,
  multiSigner: {
    threshold: number;
    verifiers: VerifierConfig[];
  },
) {
  type changeValParams = {
    threshold: number;
    multiSigAmount: number;
  };
  const sigServerHost: string[] = ['http://127.0.0.1:8001', 'http://127.0.0.1:8002', 'http://127.0.0.1:8003'];
  // change 2/3 to 1/2. then change 1/2 to 1/3
  const changeParams: changeValParams[] = [
    { threshold: 1, multiSigAmount: 2 },
    { threshold: 1, multiSigAmount: 3 },
  ];
  const validatorInfosPath = `${configPath}/change-val/validatorInfos.json`;
  const changeValRawTxPath = `${configPath}/change-val/changeValidatorRawTx.json`;
  const changeValTxWithSigDir = `${configPath}/change-val/sig/`;
  if (!fs.existsSync(changeValTxWithSigDir)) {
    fs.mkdirSync(changeValTxWithSigDir, { recursive: true });
  }
  let oldThreshold = multiSigner.threshold;
  let oldMultiSigAmount = multiSigner.verifiers.length;
  for (const params of changeParams) {
    const valInfos: ValInfos = {
      ckb: {
        newThreshold: params.threshold,
        oldValInfos: {
          R: 0,
          M: oldThreshold,
          publicKeyHashes: multiSigner.verifiers.map((v) => v.ckbPubkeyHash).slice(0, oldMultiSigAmount),
        },
      },
      eth: {
        contractAddr: bridgeEthAddress,
        newThreshold: params.threshold,
        oldValidators: multiSigner.verifiers.map((v) => v.ethAddress).slice(0, oldMultiSigAmount),
      },
      newValRpcURLs: sigServerHost.slice(0, params.multiSigAmount),
    };
    writeJsonToFile(valInfos, validatorInfosPath);
    logger.info(
      `------ start change validators from ${oldThreshold}/${oldMultiSigAmount} to ${params.threshold}/${params.multiSigAmount}. save validator info to ${validatorInfosPath} ------ `,
    );
    await execShellCmd(
      `${forcecli} change-val set  --ckbPrivateKey ${CKB_PRIVKEY} --input ${validatorInfosPath} --output ${changeValRawTxPath}`,
      true,
    );
    for (let i = 0; i < multiSigner.verifiers.length; i++) {
      await execShellCmd(
        `${forcecli} change-val sign --ckbPrivateKey ${multiSigner.verifiers[i].privkey} --ethPrivateKey ${multiSigner.verifiers[i].privkey}  --input ${changeValRawTxPath} --output ${changeValTxWithSigDir}changeValidatorTxWithSig-${i}.json`,
        true,
      );
    }

    await execShellCmd(
      `${forcecli} change-val send  --ckbPrivateKey ${CKB_PRIVKEY} --ethPrivateKey ${ETH_PRIVKEY} --input ${changeValTxWithSigDir} --source ${changeValRawTxPath}`,
      true,
    );
    logger.info(
      `------ end change validators from ${oldThreshold}/${oldMultiSigAmount} to ${params.threshold}/${params.multiSigAmount} successfully -------`,
    );
    const collectorConfig: { forceBridge: Config } = JSON.parse(
      fs.readFileSync(path.join(configPath, 'collector/force_bridge.json'), 'utf8').toString(),
    );
    collectorConfig.forceBridge.ckb.multisigScript = {
      R: 0,
      M: params.threshold,
      publicKeyHashes: multiSigner.verifiers.map((v) => v.ckbPubkeyHash).slice(0, params.multiSigAmount),
    };
    writeJsonToFile(collectorConfig, path.join(configPath, 'collector/force_bridge.json'));
    oldMultiSigAmount = params.multiSigAmount;
    oldThreshold = params.threshold;
    await asyncSleep(5000);
  }
}

async function main() {
  initLog({ level: 'debug', identity: 'integration' });
  logger.info('start integration test');

  // used for deploy and run service
  const ETH_PRIVATE_KEY = '0xc4ad657963930fbff2e9de3404b30a4e21432c89952ed430b56bf802945ed37a';
  const CKB_PRIVATE_KEY = '0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe';
  // used for test
  const ETH_TEST_PRIVKEY = '0x719e94ec5d2ecef67b5878503ffd6e1e0e2fe7a52ddd55c436878cb4d52d376d';
  const CKB_TEST_PRIVKEY = '0xa6b8e0cbadda5c0d91cf82d1e8d8120b755aa06bc49030ca6e8392458c65fc80';

  const MULTISIG_NUMBER = 3;
  const MULTISIG_THRESHOLD = 2;
  const FORCE_BRIDGE_KEYSTORE_PASSWORD = '123456';
  const ETH_RPC_URL = 'http://127.0.0.1:8545';
  const CKB_RPC_URL = 'http://127.0.0.1:8114';
  const CKB_INDEXER_URL = 'http://127.0.0.1:8116';
  const FORCE_BRIDGE_URL = 'http://127.0.0.1:8080/force-bridge/api/v1';

  const configPath = pathFromProjectRoot('workdir/integration');
  const offchainModulePath = pathFromProjectRoot('offchain-modules');
  const tsnodePath = path.join(offchainModulePath, 'node_modules/.bin/ts-node');
  const forcecli = `${tsnodePath} ${offchainModulePath}/packages/app-cli/src/index.ts`;

  const initConfig = {
    common: {
      log: {
        level: 'info',
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
    eth: {
      rpcUrl: 'http://127.0.0.1:8545',
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
      startBlockHeight: 1,
      confirmNumber: 1,
      sudtSize: 200,
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
  await handleDb('drop', MULTISIG_NUMBER);
  await handleDb('create', MULTISIG_NUMBER);
  await startVerifierService(FORCE_BRIDGE_KEYSTORE_PASSWORD, forcecli, configPath, MULTISIG_NUMBER);
  await asyncSleep(60000);
  // await startChangeVal(forcecli, configPath, bridgeEthAddress, CKB_TEST_PRIVKEY, ETH_TEST_PRIVKEY, multisigConfig);
  await startCollectorService(FORCE_BRIDGE_KEYSTORE_PASSWORD, forcecli, configPath);
  await ethBatchTest(
    ETH_TEST_PRIVKEY,
    CKB_TEST_PRIVKEY,
    ETH_RPC_URL,
    CKB_RPC_URL,
    CKB_INDEXER_URL,
    FORCE_BRIDGE_URL,
    3,
  );
  await rpcTest(FORCE_BRIDGE_URL, CKB_RPC_URL, ETH_RPC_URL, CKB_TEST_PRIVKEY, ETH_TEST_PRIVKEY, bridgeEthAddress);
  logger.info('integration test pass!');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error(`integration test failed, error: ${error.stack}`);
    process.exit(1);
  });
