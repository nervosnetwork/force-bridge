import nconf from 'nconf';
import { resolveCurrentPackagePath, resolveOffChainModulesPath } from '../resolvePath';
import { Config } from '@force-bridge/x/dist/config';
import * as lodash from 'lodash';
import { writeJsonToFile } from '@force-bridge/x/dist/utils';

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
  nconf
    .env()
    .file('ckb_deps', '/tmp/force-bridge/ckb_deps.json')
    .file('ckb_owner_cell_config', '/tmp/force-bridge/ckb_owner_cell_config.json')
    .file('eth_contract_config', '/tmp/force-bridge/eth_contract_config.json')
    .file('multisig', resolveCurrentPackagePath('src/integration-test/config/multisig.json'))
    .file('asset-white-list', resolveCurrentPackagePath('src/integration-test/config/asset-white-list.json'))
    .file('init', resolveCurrentPackagePath('src/integration-test/config/init.json'));
  let config: Config = nconf.get('forceBridge');
  console.dir(config, { depth: null });
  const generatedConfigPath = resolveCurrentPackagePath('generated/ci');
  console.log(`generatedConfigPath: ${generatedConfigPath}`);
  // generate collector config
  let collectorConfig: Config = lodash.cloneDeep(config);
  collectorConfig.common.role = 'collector';
  collectorConfig.common.orm.database = 'collector';
  collectorConfig.eth.privateKey = `${generatedConfigPath}/privkeys/eth`;
  collectorConfig.ckb.fromPrivateKey = `${generatedConfigPath}/privkeys/ckb`;
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
  writeJsonToFile({ forceBridge: collectorConfig }, `${generatedConfigPath}/collector.json`);
  // generate verifier config
  let verifierIndex = 1;
  for (const verifier of verifiers) {
    let verifierConfig: Config = lodash.cloneDeep(config);
    verifierConfig.common.role = 'verifier';
    verifierConfig.common.orm.database = `verifier${verifierIndex}`;
    verifierConfig.eth.multiSignKeys = [
      {
        privKey: `${generatedConfigPath}/privkeys/eth-multisig-${verifierIndex}`,
        address: verifier.eth.address,
      },
    ];
    verifierConfig.ckb.multiSignKeys = [
      {
        privKey: `${generatedConfigPath}/privkeys/ckb-multisig-${verifierIndex}`,
        address: verifier.ckb.address,
      },
    ];
    verifierConfig.common.port = verifier.port;
    writeJsonToFile({ forceBridge: verifierConfig }, `${generatedConfigPath}/verifier${verifierIndex}.json`);
    verifierIndex++;
  }
  // generate watcher config
  let watcherConfig: Config = lodash.cloneDeep(config);
  watcherConfig.common.role = 'watcher';
  watcherConfig.common.orm.database = 'collector';
  writeJsonToFile({ forceBridge: watcherConfig }, `${generatedConfigPath}/watcher.json`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
