import { Config } from '@force-bridge/x/dist/config';
import nconf from 'nconf';
import { startRpcServer } from './server';
import { getFromEnv } from '@force-bridge/x/dist/utils';

async function main() {
  const configPath = getFromEnv('CONFIG_PATH');
  await startRpcServer(configPath);
}

main();
