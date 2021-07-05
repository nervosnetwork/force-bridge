import fs from 'fs';
import path from 'path';
import { Config } from '@force-bridge/x/dist/config';
import { getFromEnv, writeJsonToFile } from '@force-bridge/x/dist/utils';
import * as lodash from 'lodash';
import nconf from 'nconf';
import { multiSigNode, nodeConfigPath } from './types';

async function generateConfig() {
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
  config.common.keystorePath = getFromEnv('FORCE_BRIDGE_KEYSTORE_PATH');
  getFromEnv('FORCE_BRIDGE_KEYSTORE_PASSWORD');
  JSON.parse(fs.readFileSync(path.join(configPath, 'privkeys.json'), 'utf8').toString());
  const nodeInfos: { nodes: multiSigNode[] } = JSON.parse(fs.readFileSync(nodeConfigPath, 'utf8').toString());

  // generate collector config
  const collectorConfig: Config = lodash.cloneDeep(config);
  collectorConfig.common.role = 'collector';
  collectorConfig.common.orm.database = 'collector';
  collectorConfig.eth.privateKey = `eth`;
  collectorConfig.ckb.fromPrivateKey = `ckb`;

  collectorConfig.eth.multiSignHosts = nodeInfos.nodes.map((v) => {
    return {
      address: v.ethAddress,
      host: `${v.serverLink}/force-bridge/sign-server/api/v1`,
    };
  });
  collectorConfig.ckb.multiSignHosts = nodeInfos.nodes.map((v) => {
    return {
      address: v.ethAddress,
      host: `${v.serverLink}/force-bridge/sign-server/api/v1`,
    };
  });
  collectorConfig.common.log.logFile = path.join(configPath, 'logs/collector.log');
  writeJsonToFile({ forceBridge: collectorConfig }, path.join(configPath, 'collector.json'));
  // generate verifier config
  let verifierIndex = 1;
  for (const verifier of nodeInfos.nodes) {
    const verifierConfig: Config = lodash.cloneDeep(config);
    verifierConfig.common.role = 'verifier';
    verifierConfig.common.orm.database = `verifier${verifierIndex}`;
    verifierConfig.eth.multiSignKeys = [
      {
        privKey: `multisig-${verifierIndex}`,
        address: verifier.ethAddress,
      },
    ];
    verifierConfig.ckb.multiSignKeys = [
      {
        privKey: `multisig-${verifierIndex}`,
        address: verifier.ckbAddress,
      },
    ];
    verifierConfig.common.port = 8000 + verifierIndex;
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
  await generateConfig();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });