import fs from 'fs';
import path from 'path';
import { KeyStore } from '@force-bridge/keystore/dist';
import { Config } from '@force-bridge/x/dist/config';
import {
  getFromEnv,
  writeJsonToFile,
  privateKeyToEthAddress,
  privateKeyToCkbAddress,
} from '@force-bridge/x/dist/utils';
import * as lodash from 'lodash';
import nconf from 'nconf';

async function generateConfig(multisigNumber: number) {
  const configPath = getFromEnv('CONFIG_PATH');
  nconf
    .env()
    .file('ckb_deps', path.join(configPath, 'ckb_deps.json'))
    .file('ckb_owner_cell_config', path.join(configPath, 'ckb_owner_cell_config.json'))
    .file('eth_contract_config', path.join(configPath, 'eth_contract_config.json'))
    .file('asset-white-list', path.join(configPath, 'asset-white-list.json'))
    .file('multisig', path.join(configPath, 'multisig.json'))
    .file('init', path.join(configPath, 'init.json'));
  const config: Config = nconf.get('forceBridge');
  console.dir(config, { depth: null });
  // keystore
  const password = getFromEnv('FORCE_BRIDGE_KEYSTORE_PASSWORD');
  const privkeys = JSON.parse(fs.readFileSync(path.join(configPath, 'privkeys.json'), 'utf8').toString());
  const store = KeyStore.createFromPairs(privkeys, password);
  const encrypted = store.getEncryptedData();
  const keystorePath = path.join(configPath, 'keystore.json');
  writeJsonToFile(encrypted, keystorePath);
  config.common.keystorePath = keystorePath;
  const verifiers = lodash.range(multisigNumber).map((i) => {
    const privkey = privkeys[`multisig-${i + 1}`];
    return {
      eth: {
        address: privateKeyToEthAddress(privkey),
        privKey: `multisig-${i + 1}`,
      },
      ckb: {
        address: privateKeyToCkbAddress(privkey),
        privKey: `multisig-${i + 1}`,
      },
      port: 8000 + i,
    };
  });
  // generate collector config
  const collectorConfig: Config = lodash.cloneDeep(config);
  collectorConfig.common.role = 'collector';
  collectorConfig.common.orm.database = 'collector';
  collectorConfig.eth.privateKey = `eth`;
  collectorConfig.ckb.privateKey = `ckb`;
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
  collectorConfig.common.log.logFile = path.join(configPath, 'logs/collector.log');
  writeJsonToFile({ forceBridge: collectorConfig }, path.join(configPath, 'collector.json'));
  // generate verifier config
  let verifierIndex = 1;
  for (const verifier of verifiers) {
    const verifierConfig: Config = lodash.cloneDeep(config);
    verifierConfig.common.role = 'verifier';
    verifierConfig.common.orm.database = `verifier${verifierIndex}`;
    verifierConfig.eth.privateKey = `multisig-${verifierIndex}`;
    verifierConfig.ckb.privateKey = `multisig-${verifierIndex}`;
    verifierConfig.common.port = verifier.port;
    verifierConfig.common.log.logFile = path.join(configPath, `logs/verifier${verifierIndex}.log`);
    writeJsonToFile({ forceBridge: verifierConfig }, path.join(configPath, `verifier${verifierIndex}.json`));
    verifierIndex++;
  }
  // generate watcher config
  const watcherConfig: Config = lodash.cloneDeep(config);
  watcherConfig.common.role = 'watcher';
  // fixme: the test only pass when using the collector db
  watcherConfig.common.orm.database = 'collector';
  collectorConfig.common.log.logFile = path.join(configPath, 'logs/watcher.log');
  writeJsonToFile({ forceBridge: watcherConfig }, path.join(configPath, 'watcher.json'));
}

async function main() {
  const multisigNumber = parseInt(getFromEnv('MULTISIG_NUMBER'));
  await generateConfig(multisigNumber);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
