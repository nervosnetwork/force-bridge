import 'reflect-metadata';
import { Config } from '@force-bridge/x/dist/config';
import nconf from 'nconf';
import { startRelayer } from './relayer';

async function main() {
  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const config: Config = nconf.get('forceBridge');
  await startRelayer(config);
}

main();
