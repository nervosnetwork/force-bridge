import 'reflect-metadata';
import { Config } from '@force-bridge/x/dist/config';
import { getFromEnv } from '@force-bridge/x/dist/utils';
import nconf from 'nconf';
import { startRelayer } from './relayer';

async function main(): Promise<void> {
  const configPath = getFromEnv('CONFIG_PATH');
  nconf.env().file({ file: configPath });
  const config: Config = nconf.get('forceBridge');
  await startRelayer(config);
}

void main();
