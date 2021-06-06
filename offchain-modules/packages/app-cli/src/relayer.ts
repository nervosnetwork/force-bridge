import { startRelayer } from '@force-bridge/app-relayer/dist/relayer';
import { Config } from '@force-bridge/x/dist/config';
import commander from 'commander';
import nconf from 'nconf';
import { parseOptions } from './utils';

const defaultConfig = './config.json';

export const relayerCmd = new commander.Command('relayer')
  .option('-cfg, --config', 'config path of replayer', defaultConfig)
  .action(sigServer);

async function sigServer(opts: { port: string }, command: commander.Command) {
  const options = parseOptions(opts, command);
  const configPath = options.get('config') !== undefined ? options.get('config') : defaultConfig;
  nconf.env().file({ file: configPath });
  const cfg: Config = nconf.get('forceBridge');
  await startRelayer(cfg);
}
