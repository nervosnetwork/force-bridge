import { Config } from '@force-bridge/x/dist/config';
import nconf from 'nconf';
import { startSigServer } from './sigServer';

async function main() {
  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const cfg: Config = nconf.get('forceBridge');

  let defaultPort = 80;
  let port = cfg.common.port || defaultPort;
  await startSigServer(cfg, port);
}

main();
