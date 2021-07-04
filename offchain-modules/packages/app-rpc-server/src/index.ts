import { getFromEnv } from '@force-bridge/x/dist/utils';
import { startRpcServer } from './server';

async function main() {
  const configPath = getFromEnv('CONFIG_PATH');
  await startRpcServer(configPath);
}

void main();
