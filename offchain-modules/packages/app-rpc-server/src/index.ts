import { Config } from '@force-bridge/x/dist/config';
import nconf from 'nconf';
import { startRpcServer } from './server';

async function main() {
  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const config: Config = nconf.get('forceBridge');
  await startRpcServer(config);
}

main();
