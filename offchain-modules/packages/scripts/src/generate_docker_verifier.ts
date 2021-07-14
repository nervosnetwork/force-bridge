import path from 'path';
import { Config } from '@force-bridge/x/dist/config';
import { getFromEnv, writeJsonToFile } from '@force-bridge/x/dist/utils';
import nconf from 'nconf';
import { verifierServerBasePort } from './types';

async function generateConfig() {
  const verifierIndex = getFromEnv('VERIFIER_INDEX');
  const configPath = getFromEnv('CONFIG_PATH');
  nconf.env().file(`verifier${verifierIndex}`, path.join(configPath, `verifier${verifierIndex}.json`));
  const verifierConfig: Config = nconf.get('forceBridge');

  verifierConfig.common.orm.host = 'mysql-relayer';

  //FIXME: cannot connect to node when using http://geth:8545
  verifierConfig.eth.rpcUrl = 'http://10.5.0.105:8545';
  verifierConfig.ckb.ckbRpcUrl = 'http://ckb:8114';
  verifierConfig.ckb.ckbIndexerUrl = 'http://ckb-indexer:8116';

  verifierConfig.common.port = verifierServerBasePort;
  verifierConfig.common.keystorePath = getFromEnv('FORCE_BRIDGE_KEYSTORE_PATH');
  verifierConfig.common.log.logFile = path.join(configPath, `logs/verifier.log`);
  writeJsonToFile({ forceBridge: verifierConfig }, path.join(configPath, `verifier.json`));
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
