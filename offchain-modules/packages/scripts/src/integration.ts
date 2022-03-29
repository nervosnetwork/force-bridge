import fs from 'fs';
import path from 'path';
import { ValInfos } from '@force-bridge/cli/src/changeVal';
import { KeyStore } from '@force-bridge/keystore/dist';
import { OmniLockCellConfig, OwnerCellConfig } from '@force-bridge/x/dist/ckb/tx-helper/deploy';
import {
  Config,
  WhiteListEthAsset,
  WhiteListNervosAsset,
  CkbDeps,
  CKB_TYPESCRIPT_HASH,
} from '@force-bridge/x/dist/config';
import { asyncSleep, privateKeyToCkbPubkeyHash, writeJsonToFile } from '@force-bridge/x/dist/utils';
import { logger, initLog } from '@force-bridge/x/dist/utils/logger';
import { ContractNetworksConfig } from '@gnosis.pm/safe-core-sdk';
import { ethers } from 'ethers';
import * as lodash from 'lodash';
import * as shelljs from 'shelljs';
import { execShellCmd, pathFromProjectRoot } from './utils';
import { rpcTest as ckbRpcTest } from './utils/ckb-rpc-ci';
import { ckbBatchTest } from './utils/ckb_batch_test';
import { deployDev } from './utils/deploy';
import { ethBatchTest } from './utils/eth_batch_test';
import { genRandomVerifierConfig } from './utils/generate';
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
  nervosAssetWhiteList: WhiteListNervosAsset[],
  ckbDeps: CkbDeps,
  ownerCellConfig: OwnerCellConfig,
  omniLockCellConfig: OmniLockCellConfig,
  ethContractAddress: string,
  multisigConfig: MultisigConfig,
  extraMultiSigConfig: MultisigConfig,
  ckbStartHeight: number,
  ethStartHeight: number,
  configPath: string,
  ETH_PRIVATE_KEY: string,
  CKB_PRIVATE_KEY: string,
  password: string,
  assetManagerContractAddress: string,
  safeAddress: string,
  safeContractNetworks: ContractNetworksConfig,
  sudtSize = 200,
) {
  const baseConfig: Config = lodash.cloneDeep(initConfig);
  logger.debug(`baseConfig: ${JSON.stringify(baseConfig, null, 2)}`);
  baseConfig.eth.contractAddress = ethContractAddress;
  baseConfig.eth.assetManagerContractAddress = assetManagerContractAddress;
  baseConfig.ckb.deps = ckbDeps;
  baseConfig.ckb.ownerCellTypescript = ownerCellConfig.ownerCellTypescript;
  baseConfig.ckb.omniLockAdminCellTypescript = omniLockCellConfig.adminCellTypescript;
  baseConfig.ckb.startBlockHeight = ckbStartHeight;
  baseConfig.eth.startBlockHeight = ethStartHeight;
  baseConfig.eth.safeMultisignContractAddress = safeAddress;
  baseConfig.eth.safeMultisignContractNetworks = safeContractNetworks;
  baseConfig.eth.lockNervosAssetFee = '20000000000';
  baseConfig.eth.burnNervosAssetFee = '20000000000';
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
  collectorConfig.eth.assetWhiteList = assetWhiteList;
  collectorConfig.eth.nervosAssetWhiteList = nervosAssetWhiteList;
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
  watcherConfig.eth.assetWhiteList = assetWhiteList;
  watcherConfig.eth.nervosAssetWhiteList = nervosAssetWhiteList;
  watcherConfig.ckb.sudtSize = sudtSize;
  writeJsonToFile({ forceBridge: watcherConfig }, path.join(configPath, 'watcher/force_bridge.json'));
  // verifiers
  multisigConfig.verifiers.concat(extraMultiSigConfig.verifiers).map((v, i) => {
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
      `cross-env FORCE_BRIDGE_KEYSTORE_PASSWORD=${FORCE_BRIDGE_KEYSTORE_PASSWORD} ${forcecli} verifier -cfg ${configPath}/verifier${i}/force_bridge.json`,
      false,
    );
  }
  await execShellCmd(
    `cross-env FORCE_BRIDGE_KEYSTORE_PASSWORD=${FORCE_BRIDGE_KEYSTORE_PASSWORD} ${forcecli} rpc -cfg ${path.join(
      configPath,
      'watcher/force_bridge.json',
    )}`,
    false,
  );
}

async function startCollectorService(FORCE_BRIDGE_KEYSTORE_PASSWORD: string, forcecli: string, configPath: string) {
  await execShellCmd(
    `cross-env FORCE_BRIDGE_KEYSTORE_PASSWORD=${FORCE_BRIDGE_KEYSTORE_PASSWORD} ${forcecli} collector -cfg ${configPath}/collector/force_bridge.json`,
    false,
  );
}

async function startChangeVal(
  forcecli: string,
  configPath: string,
  bridgeEthAddress: string,
  safeAddress: string,
  contractNetworks: ContractNetworksConfig,
  CKB_PRIVKEY: string,
  ETH_PRIVKEY: string,
  oldMultiSigner: MultisigConfig,
  extraMultiSigConfig: MultisigConfig,
) {
  const newThreshold = extraMultiSigConfig.threshold;
  const newMultiSigConfig: VerifierConfig[] = [oldMultiSigner.verifiers[1]].concat(extraMultiSigConfig.verifiers);

  // from old 1/2 to new 3/4. 8002 is on behalf of the old. 8003,8004,8005 are on behalf of the new
  const sigServerHost: string[] = [
    'http://127.0.0.1:8002',
    'http://127.0.0.1:8003',
    'http://127.0.0.1:8004',
    'http://127.0.0.1:8005',
  ];
  const validatorInfosPath = `${configPath}/change-val/validatorInfos.json`;
  const changeValRawTxPath = `${configPath}/change-val/changeValidatorRawTx.json`;
  const changeValTxWithSigDir = `${configPath}/change-val/sig/`;
  if (!fs.existsSync(changeValTxWithSigDir)) {
    fs.mkdirSync(changeValTxWithSigDir, { recursive: true });
  }
  const valInfos: ValInfos = {
    ckb: {
      newThreshold: newThreshold,
      oldValInfos: {
        R: 0,
        M: oldMultiSigner.threshold,
        publicKeyHashes: oldMultiSigner.verifiers.map((v) => v.ckbPubkeyHash),
      },
    },
    eth: {
      contractAddr: bridgeEthAddress,
      newThreshold: newThreshold,
      oldValidators: oldMultiSigner.verifiers.map((v) => v.ethAddress),
    },
    ethGnosisSafe: {
      safeAddress,
      contractNetworks,
      threshold: newThreshold,
    },
    newValRpcURLs: sigServerHost,
  };
  writeJsonToFile(valInfos, validatorInfosPath);
  logger.info(
    `------ start to change validators from 1/2 to 3/4. save validator info to ${validatorInfosPath} ------ `,
  );
  await execShellCmd(
    `${forcecli} change-val set  --ckbPrivateKey ${CKB_PRIVKEY} --input ${validatorInfosPath} --output ${changeValRawTxPath}`,
    true,
  );
  for (let i = 0; i < oldMultiSigner.verifiers.length; i++) {
    await execShellCmd(
      `${forcecli} change-val sign --ckbPrivateKey ${oldMultiSigner.verifiers[i].privkey} --ethPrivateKey ${oldMultiSigner.verifiers[i].privkey}  --input ${changeValRawTxPath} --output ${changeValTxWithSigDir}changeValidatorTxWithSig-${i}.json`,
      true,
    );
  }

  await execShellCmd(
    `${forcecli} change-val send  --ckbPrivateKey ${CKB_PRIVKEY} --ethPrivateKey ${ETH_PRIVKEY} --input ${changeValTxWithSigDir} --source ${changeValRawTxPath}`,
    true,
  );

  await execShellCmd(
    `${forcecli} change-val set  --ckbPrivateKey ${CKB_PRIVKEY} --input ${validatorInfosPath} --output ${changeValRawTxPath}`,
    true,
  );

  for (let i = 0; i < newMultiSigConfig.length; i++) {
    await execShellCmd(
      `${forcecli} change-val sign --ckbPrivateKey ${newMultiSigConfig[i].privkey} --ethPrivateKey ${newMultiSigConfig[i].privkey}  --input ${changeValRawTxPath} --output ${changeValTxWithSigDir}changeValidatorTxWithSig-${i}.json`,
      true,
    );
  }

  await execShellCmd(
    `${forcecli} change-val send  --ckbPrivateKey ${CKB_PRIVKEY} --ethPrivateKey ${ETH_PRIVKEY} --input ${changeValTxWithSigDir} --source ${changeValRawTxPath}`,
    true,
  );

  logger.info(`------  change validators from 1/2 to 3/4 successfully -------`);
  const collectorConfig: { forceBridge: Config } = JSON.parse(
    fs.readFileSync(path.join(configPath, 'collector/force_bridge.json'), 'utf8').toString(),
  );
  collectorConfig.forceBridge.eth.multiSignThreshold = newThreshold;
  collectorConfig.forceBridge.eth.multiSignAddresses = newMultiSigConfig.map((v) => v.ethAddress);
  collectorConfig.forceBridge.ckb.multisigScript = {
    R: 0,
    M: newThreshold,
    publicKeyHashes: newMultiSigConfig.map((v) => v.ckbPubkeyHash),
  };

  collectorConfig.forceBridge.eth.multiSignHosts = newMultiSigConfig.map((v, i) => {
    return {
      address: v.ethAddress,
      host: `http://127.0.0.1:${8002 + i}/force-bridge/sign-server/api/v1`,
    };
  });
  collectorConfig.forceBridge.ckb.multiSignHosts = newMultiSigConfig.map((v, i) => {
    return {
      address: v.ckbAddress,
      host: `http://127.0.0.1:${8002 + i}/force-bridge/sign-server/api/v1`,
    };
  });

  writeJsonToFile(collectorConfig, path.join(configPath, 'collector/force_bridge.json'));
  await asyncSleep(5000);
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

  const ETH_TEST_PRIVKEY_2 = '0x627ed509aa9ef55858d01453c62f44287f639a4fa5a444af150f333b6010a3b6';
  const CKB_TEST_PRIVKEY_2 = '0x13b08bb054d5dd04013156dced8ba2ce4d8cc5973e10d905a228ea1abc267e60';

  const MULTISIG_NUMBER = 2;
  const MULTISIG_THRESHOLD = 2;
  const EXTRA_MULTISIG_NUMBER = 3;
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
    },
    ckb: {
      ckbRpcUrl: 'http://127.0.0.1:8114',
      ckbIndexerUrl: 'http://127.0.0.1:8116',
      startBlockHeight: 1,
      confirmNumber: 1,
    },
  };
  const {
    assetWhiteList,
    nervosAssetWhiteList,
    ckbDeps,
    ownerConfig,
    omniLockConfig,
    bridgeEthAddress,
    multisigConfig,
    ckbStartHeight,
    ethStartHeight,
    assetManagerContractAddress,
    safeAddress,
    safeContractNetworks,
  } = await deployDev(
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

  const extraMultiSigConfig = {
    threshold: EXTRA_MULTISIG_NUMBER,
    verifiers: lodash.range(EXTRA_MULTISIG_NUMBER).map((_i) => genRandomVerifierConfig()),
  };
  logger.info(`extra multiSig config ${JSON.stringify(extraMultiSigConfig, null, 2)}`);
  await generateConfig(
    initConfig as unknown as Config,
    assetWhiteList,
    nervosAssetWhiteList,
    ckbDeps,
    ownerConfig,
    omniLockConfig,
    bridgeEthAddress,
    multisigConfig,
    extraMultiSigConfig,
    ckbStartHeight,
    ethStartHeight,
    configPath,
    ETH_PRIVATE_KEY,
    CKB_PRIVATE_KEY,
    FORCE_BRIDGE_KEYSTORE_PASSWORD,
    assetManagerContractAddress,
    safeAddress,
    safeContractNetworks,
  );
  await handleDb('drop', MULTISIG_NUMBER + EXTRA_MULTISIG_NUMBER);
  await handleDb('create', MULTISIG_NUMBER + EXTRA_MULTISIG_NUMBER);
  await startVerifierService(
    FORCE_BRIDGE_KEYSTORE_PASSWORD,
    forcecli,
    configPath,
    MULTISIG_NUMBER + EXTRA_MULTISIG_NUMBER,
  );
  const command = `cross-env FORCE_BRIDGE_KEYSTORE_PASSWORD=${FORCE_BRIDGE_KEYSTORE_PASSWORD} ${forcecli} collector -cfg ${configPath}/collector/force_bridge.json`;
  await asyncSleep(120000);
  const collectorProcess = shelljs.exec(command, { async: true });
  await Promise.all([
    ethereumIntegration(
      ETH_TEST_PRIVKEY,
      CKB_TEST_PRIVKEY,
      ETH_RPC_URL,
      CKB_RPC_URL,
      CKB_INDEXER_URL,
      FORCE_BRIDGE_URL,
      bridgeEthAddress,
    ),
    nervosIntegration(
      ETH_TEST_PRIVKEY_2,
      CKB_TEST_PRIVKEY_2,
      ETH_RPC_URL,
      CKB_RPC_URL,
      CKB_INDEXER_URL,
      FORCE_BRIDGE_URL,
      bridgeEthAddress,
      nervosAssetWhiteList,
    ),
  ]);
  logger.info('integration test pass!');
  // only test change validator when the env is set
  if (!process.env.TEST_CHANGE_VALIDATOR) {
    return;
  }
  collectorProcess.kill();
  await startChangeVal(
    forcecli,
    configPath,
    bridgeEthAddress,
    safeAddress,
    safeContractNetworks,
    CKB_TEST_PRIVKEY,
    ETH_TEST_PRIVKEY,
    multisigConfig,
    extraMultiSigConfig,
  );
  await asyncSleep(60000);
  await startCollectorService(FORCE_BRIDGE_KEYSTORE_PASSWORD, forcecli, configPath);
  await Promise.all([
    ethereumIntegration(
      ETH_TEST_PRIVKEY,
      CKB_TEST_PRIVKEY,
      ETH_RPC_URL,
      CKB_RPC_URL,
      CKB_INDEXER_URL,
      FORCE_BRIDGE_URL,
      bridgeEthAddress,
    ),
    nervosIntegration(
      ETH_TEST_PRIVKEY_2,
      CKB_TEST_PRIVKEY_2,
      ETH_RPC_URL,
      CKB_RPC_URL,
      CKB_INDEXER_URL,
      FORCE_BRIDGE_URL,
      bridgeEthAddress,
      nervosAssetWhiteList,
    ),
  ]);
  logger.info('change validator test pass!');
}

async function ethereumIntegration(
  ETH_TEST_PRIVKEY: string,
  CKB_TEST_PRIVKEY: string,
  ETH_RPC_URL: string,
  CKB_RPC_URL: string,
  CKB_INDEXER_URL: string,
  FORCE_BRIDGE_URL: string,
  bridgeEthAddress: string,
) {
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
}

async function nervosIntegration(
  ETH_TEST_PRIVKEY: string,
  CKB_TEST_PRIVKEY: string,
  ETH_RPC_URL: string,
  CKB_RPC_URL: string,
  CKB_INDEXER_URL: string,
  FORCE_BRIDGE_URL: string,
  bridgeEthAddress: string,
  nervosAssetWhiteList: WhiteListNervosAsset[],
) {
  await ckbBatchTest(
    ETH_TEST_PRIVKEY,
    CKB_TEST_PRIVKEY,
    ETH_RPC_URL,
    CKB_RPC_URL,
    CKB_INDEXER_URL,
    FORCE_BRIDGE_URL,
    3,
    nervosAssetWhiteList,
  );

  const asset = nervosAssetWhiteList.find((v) => {
    return v.typescriptHash == CKB_TYPESCRIPT_HASH;
  })!;

  await ckbRpcTest(
    FORCE_BRIDGE_URL,
    CKB_RPC_URL,
    ETH_RPC_URL,
    CKB_TEST_PRIVKEY,
    ETH_TEST_PRIVKEY,
    bridgeEthAddress,
    asset.xchainTokenAddress,
    CKB_TYPESCRIPT_HASH,
    ethers.BigNumber.from(asset.minimalBridgeAmount),
    asset.decimal,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error(`integration test failed, error: ${error.stack}`);
    process.exit(1);
  });
