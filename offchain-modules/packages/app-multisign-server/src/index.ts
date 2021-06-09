import { Config } from '@force-bridge/x/dist/config';
import minimist from 'minimist';
import nconf from 'nconf';
import { startSigServer } from './sigServer';

async function main() {
  const args = minimist(process.argv.slice(2));
  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const cfg: Config = nconf.get('forceBridge');

  let port = 8090;
  if (args.port != undefined) {
    port = args.port;
  }
  await startSigServer(cfg, port);
}

main();
