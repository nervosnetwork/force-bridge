import { Config } from '@force-bridge/x/dist/config';
import nconf from 'nconf';
import { startSigServer } from './sigServer';

async function main(): Promise<void> {
  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const cfg: Config = nconf.get('forceBridge');

  const defaultPort = 80;
  const port = cfg.common.port || defaultPort;
  await startSigServer(cfg, port);
}

void main();
