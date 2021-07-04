import { getFromEnv } from '@force-bridge/x/dist/utils';
import { startSigServer } from './sigServer';

async function main(): Promise<void> {
  const configPath = getFromEnv('CONFIG_PATH');
  await startSigServer(configPath);
}

void main();
