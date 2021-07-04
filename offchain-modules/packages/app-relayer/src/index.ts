import 'reflect-metadata';
import { getFromEnv } from '@force-bridge/x/dist/utils';
import { startRelayer } from './relayer';

async function main(): Promise<void> {
  const configPath = getFromEnv('CONFIG_PATH');
  await startRelayer(configPath);
}

void main();
