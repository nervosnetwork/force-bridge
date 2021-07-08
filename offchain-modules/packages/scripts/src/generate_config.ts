import fs from 'fs';
import path from 'path';
import { Config } from '@force-bridge/x/dist/config';
import { getFromEnv, writeJsonToFile } from '@force-bridge/x/dist/utils';
import * as lodash from 'lodash';
import nconf from 'nconf';
import { multiSigNode, nodeConfigPath, verifierServerBasePort } from './types';

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
  const nodeInfos: { nodes: multiSigNode[] } = JSON.parse(fs.readFileSync(nodeConfigPath, 'utf8').toString());

  // generate collector config
  const collectorConfig: Config = lodash.cloneDeep(config);
  collectorConfig.common.role = 'collector';
  collectorConfig.common.orm.database = 'collector';
  collectorConfig.common.port = 8090;
  collectorConfig.eth.privateKey = `eth`;
  collectorConfig.ckb.privateKey = `ckb`;
  collectorConfig.eth.multiSignHosts = nodeInfos.nodes.map((v) => {
    return {
      address: v.ethAddress,
      host: `${v.serverLink}/force-bridge/sign-server/api/v1`,
    };
  });
  collectorConfig.ckb.multiSignHosts = nodeInfos.nodes.map((v) => {
    return {
      address: v.ckbAddress,
      host: `${v.serverLink}/force-bridge/sign-server/api/v1`,
    };
  });
  collectorConfig.common.log.logFile = path.join(configPath, 'logs/collector.log');
  writeJsonToFile({ forceBridge: collectorConfig }, path.join(configPath, 'collector.json'));
  // generate verifier config

  for (let verifierIndex = 1; verifierIndex <= nodeInfos.nodes.length; verifierIndex++) {
    const verifierConfig: Config = lodash.cloneDeep(config);
    verifierConfig.common.role = 'verifier';
    verifierConfig.common.orm.database = `verifier${verifierIndex}`;
    verifierConfig.eth.privateKey = `multisig-${verifierIndex}`;
    verifierConfig.ckb.privateKey = `multisig-${verifierIndex}`;
    verifierConfig.common.port = verifierServerBasePort + verifierIndex;
    verifierConfig.common.log.logFile = path.join(configPath, `logs/verifier${verifierIndex}.log`);
    writeJsonToFile({ forceBridge: verifierConfig }, path.join(configPath, `verifier${verifierIndex}.json`));
  }
  // generate watcher config
  const watcherConfig: Config = lodash.cloneDeep(config);
  watcherConfig.common.role = 'watcher';
  // fixme: the test only pass when using the collector db
  watcherConfig.common.orm.database = 'collector';
  watcherConfig.common.port = 8080;
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
