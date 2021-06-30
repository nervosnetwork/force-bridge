import { Config } from '@force-bridge/x/dist/config';
import { getFromEnv } from '@force-bridge/x/dist/utils';
import nconf from 'nconf';
import { startRpcServer } from './server';

async function main() {
  const configPath = getFromEnv('CONFIG_PATH');
  await startRpcServer(configPath);
}

main();
