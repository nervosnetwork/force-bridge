import fs from 'fs';
import path from 'path';
import { Config } from '@force-bridge/x/dist/config';
import { getFromEnv, writeJsonToFile } from '@force-bridge/x/dist/utils';
import * as lodash from 'lodash';
import nconf from 'nconf';
import { multiSigNode, nodeConfigPath, roles, rolesConfigPath } from './types';

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
  const isRunCI = getFromEnv('IS_RUN_CI');
  const nodeInfos: { nodes: multiSigNode[] } = JSON.parse(fs.readFileSync(nodeConfigPath, 'utf8').toString());
  const rolesInfos: { roles: roles } = JSON.parse(fs.readFileSync(rolesConfigPath, 'utf8').toString());

  if (isRunCI === 'Y') {
    const ciKeystorePath = getFromEnv('FORCE_BRIDGE_KEYSTORE_PATH');
    rolesInfos.roles.watcher.configPath = path.join(configPath, 'watcher.json');
    rolesInfos.roles.watcher.logPath = path.join(configPath, 'logs/watcher.log');
    rolesInfos.roles.collector.configPath = path.join(configPath, 'collector.json');
    rolesInfos.roles.collector.logPath = path.join(configPath, 'logs/collector.log');
    rolesInfos.roles.collector.keystorePath = ciKeystorePath;
    for (let verifierIndex = 0; verifierIndex < rolesInfos.roles.verifier.length; verifierIndex++) {
      rolesInfos.roles.verifier[verifierIndex].configPath = path.join(configPath, `verifier${verifierIndex + 1}.json`);
      rolesInfos.roles.verifier[verifierIndex].logPath = path.join(configPath, `logs/verifier${verifierIndex + 1}.log`);
      rolesInfos.roles.verifier[verifierIndex].keystorePath = ciKeystorePath;
    }
  }
  console.log(`config path : ${configPath},  roles ${JSON.stringify(rolesInfos.roles, null, 2)}, run ci? : ${isRunCI}`);

  // generate collector config
  const collectorConfig: Config = lodash.cloneDeep(config);
  collectorConfig.common.role = 'collector';
  collectorConfig.common.orm = rolesInfos.roles.collector.orm;
  collectorConfig.common.port = rolesInfos.roles.collector.port;
  collectorConfig.eth.privateKey = rolesInfos.roles.collector.ethPrivateKey!;
  collectorConfig.ckb.privateKey = rolesInfos.roles.collector.ckbPrivateKey!;
  collectorConfig.common.keystorePath = rolesInfos.roles.collector.keystorePath;
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
  collectorConfig.common.log.logFile = rolesInfos.roles.collector.logPath;
  writeJsonToFile({ forceBridge: collectorConfig }, rolesInfos.roles.collector.configPath);

  for (let verifierIndex = 0; verifierIndex < rolesInfos.roles.verifier.length; verifierIndex++) {
    const verifierConfig: Config = lodash.cloneDeep(config);
    verifierConfig.common.role = 'verifier';
    verifierConfig.common.orm = rolesInfos.roles.verifier[verifierIndex].orm;
    verifierConfig.common.keystorePath = rolesInfos.roles.verifier[verifierIndex].keystorePath;
    verifierConfig.eth.privateKey = rolesInfos.roles.verifier[verifierIndex].ethPrivateKey!;
    verifierConfig.ckb.privateKey = rolesInfos.roles.verifier[verifierIndex].ckbPrivateKey!;
    verifierConfig.common.port = rolesInfos.roles.verifier[verifierIndex].port;
    verifierConfig.common.log.logFile = rolesInfos.roles.verifier[verifierIndex].logPath;
    writeJsonToFile({ forceBridge: verifierConfig }, rolesInfos.roles.verifier[verifierIndex].configPath);
  }
  // generate watcher config
  const watcherConfig: Config = lodash.cloneDeep(config);
  watcherConfig.common.role = 'watcher';
  watcherConfig.common.orm = rolesInfos.roles.watcher.orm;
  watcherConfig.common.port = rolesInfos.roles.watcher.port;
  watcherConfig.common.log.logFile = rolesInfos.roles.watcher.logPath;
  writeJsonToFile({ forceBridge: watcherConfig }, rolesInfos.roles.watcher.configPath);
  console.log(`generate config end`);
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
