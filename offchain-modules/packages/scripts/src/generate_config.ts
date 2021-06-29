import { Config } from '@force-bridge/x/dist/config';
import { getFromEnv, writeJsonToFile } from '@force-bridge/x/dist/utils';
import * as lodash from 'lodash';
import nconf from 'nconf';

const verifiers = [
  {
    eth: {
      address: '0xB026351cD0c62aC89e488A840b7205730E8476bd',
      privKey: 'privkeys/eth-multisig-1',
    },
    ckb: {
      address: 'ckt1qyqvsv5240xeh85wvnau2eky8pwrhh4jr8ts8vyj37',
      privKey: 'privkeys/ckb-multisig-1',
    },
    port: 8090,
  },
  {
    eth: {
      address: '0x27EE444d5D96094EACecC00194b7026Eb4fD979c',
      privKey: 'privkeys/eth-multisig-2',
    },
    ckb: {
      address: 'ckt1qyqywrwdchjyqeysjegpzw38fvandtktdhrs0zaxl4',
      privKey: 'privkeys/ckb-multisig-2',
    },
    port: 8091,
  },
];

async function main() {
  const configPath = getFromEnv('CONFIG_PATH');
  nconf
    .env()
    .file('ckb_deps', `${configPath}/ckb_deps.json`)
    .file('ckb_owner_cell_config', `${configPath}/ckb_owner_cell_config.json`)
    .file('eth_contract_config', `${configPath}/eth_contract_config.json`)
    .file('multisig', `${configPath}/multisig.json`)
    .file('asset-white-list', `${configPath}/asset-white-list.json`)
    .file('init', `${configPath}/init.json`);
  const config: Config = nconf.get('forceBridge');
  console.dir(config, { depth: null });
  // generate collector config
  const collectorConfig: Config = lodash.cloneDeep(config);
  collectorConfig.common.role = 'collector';
  collectorConfig.common.orm.database = 'collector';
  collectorConfig.eth.privateKey = `${configPath}/privkeys/eth`;
  collectorConfig.ckb.fromPrivateKey = `${configPath}/privkeys/ckb`;
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
        privKey: `${configPath}/privkeys/eth-multisig-${verifierIndex}`,
        address: verifier.eth.address,
      },
    ];
    verifierConfig.ckb.multiSignKeys = [
      {
        privKey: `${configPath}/privkeys/ckb-multisig-${verifierIndex}`,
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
  watcherConfig.common.orm.database = 'watcher';
  collectorConfig.common.log.logFile = `${configPath}/logs/watcher.log`;
  writeJsonToFile({ forceBridge: watcherConfig }, `${configPath}/watcher.json`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
