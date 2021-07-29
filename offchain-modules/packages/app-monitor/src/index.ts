import { getFromEnv } from '@force-bridge/x/dist/utils';
import { startMonitor } from './monitor';

async function main() {
  const configPath = getFromEnv('CONFIG_PATH');
  await startMonitor(configPath);
}

void main();
