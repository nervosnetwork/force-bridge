import fs from 'fs';
import { KeyStore } from '@force-bridge/keystore/dist';
import { Config } from '@force-bridge/x/dist/config';
import {
  getFromEnv,
  writeJsonToFile,
  privateKeyToCkbPubkeyHash,
  privateKeyToEthAddress,
  privateKeyToCkbAddress,
} from '@force-bridge/x/dist/utils';
import * as lodash from 'lodash';
import nconf from 'nconf';

async function generateConfig(multisigNumber: number, threshold: number) {
  const configPath = getFromEnv('CONFIG_PATH');
  nconf
    .env()
    .file('ckb_deps', `${configPath}/ckb_deps.json`)
    .file('ckb_owner_cell_config', `${configPath}/ckb_owner_cell_config.json`)
    .file('eth_contract_config', `${configPath}/eth_contract_config.json`)
    .file('asset-white-list', `${configPath}/asset-white-list.json`)
    .file('multisig', `${configPath}/multisig.json`)
    .file('init', `${configPath}/init.json`);
  const config: Config = nconf.get('forceBridge');
  console.dir(config, { depth: null });
  // keystore
  const password = getFromEnv('FORCE_BRIDGE_KEYSTORE_PASSWORD');
  const privkeys = JSON.parse(fs.readFileSync(`${configPath}/privkeys.json`, 'utf8').toString());
  const store = KeyStore.createFromPairs(privkeys, password);
  const encrypted = store.getEncryptedData();
  const keystorePath = `${configPath}/keystore.json`;
  writeJsonToFile(encrypted, keystorePath);
  config.common.keystorePath = keystorePath;
  const verifiers = lodash.range(multisigNumber).map((i) => {
    const privkey = privkeys[`multisig-${i}`];
    return {
      eth: {
        address: privateKeyToEthAddress(privkey),
        privKey: `multisig-${i}`,
      },
      ckb: {
        address: privateKeyToCkbAddress(privkey),
        privKey: `multisig-${i}`,
      },
      port: 8000 + i,
    };
  });
  // generate collector config
  const collectorConfig: Config = lodash.cloneDeep(config);
  collectorConfig.common.role = 'collector';
  collectorConfig.common.orm.database = 'collector';
  collectorConfig.eth.privateKey = `eth`;
  collectorConfig.ckb.fromPrivateKey = `ckb`;
  collectorConfig.eth.multiSignHosts = verifiers.map((v) => {
    return {
      address: v.eth.address,
      host: `http://127.0.0.1:${v.port}/force-bridge/sign-server/api/v1`,
    };
  });
  collectorConfig.ckb.multiSignHosts = verifiers.map((v) => {
    return {
      address: v.ckb.address,
      host: `http://127.0.0.1:${v.port}/force-bridge/sign-server/api/v1`,
    };
  });
  collectorConfig.common.log.logFile = `${configPath}/logs/collector.log`;
  writeJsonToFile({ forceBridge: collectorConfig }, `${configPath}/collector.json`);
  // generate verifier config
  let verifierIndex = 1;
  for (const verifier of verifiers) {
    const verifierConfig: Config = lodash.cloneDeep(config);
    verifierConfig.common.role = 'verifier';
    verifierConfig.common.orm.database = `verifier${verifierIndex}`;
    verifierConfig.eth.multiSignKeys = [
      {
        privKey: `multisig-${verifierIndex}`,
        address: verifier.eth.address,
      },
    ];
    verifierConfig.ckb.multiSignKeys = [
      {
        privKey: `multisig-${verifierIndex}`,
        address: verifier.ckb.address,
      },
    ];
    verifierConfig.common.port = verifier.port;
    verifierConfig.common.log.logFile = `${configPath}/logs/verifier${verifierIndex}.log`;
    writeJsonToFile({ forceBridge: verifierConfig }, `${configPath}/verifier${verifierIndex}.json`);
    verifierIndex++;
  }
  // generate watcher config
  const watcherConfig: Config = lodash.cloneDeep(config);
  watcherConfig.common.role = 'watcher';
  // fixme: the test only pass when using the collector db
  watcherConfig.common.orm.database = 'collector';
  collectorConfig.common.log.logFile = `${configPath}/logs/watcher.log`;
  writeJsonToFile({ forceBridge: watcherConfig }, `${configPath}/watcher.json`);
}

async function main() {
  const multisigNumber = parseInt(getFromEnv('MULTISIG_NUMBER'));
  const threshold = parseInt(getFromEnv('THRESHOLD'));
  await generateConfig(multisigNumber, threshold);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
