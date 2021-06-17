import { startRelayer } from '@force-bridge/app-relayer/dist/relayer';
import { Config } from '@force-bridge/x/dist/config';
import commander from 'commander';
import nconf from 'nconf';
import { parseOptions } from './utils';

const defaultConfig = './config.json';

export const relayerCmd = new commander.Command('relayer')
  .option('-cfg, --config', `config path of replayer default:${defaultConfig}`, defaultConfig)
  .action(sigServer);

async function sigServer(command: commander.Command, args: any) {
  const opts = command.opts();
  const options = parseOptions(opts, args);
  const configPath = options.get('config') !== undefined ? options.get('config') : defaultConfig;
  nconf.env().file({ file: configPath });
  const cfg: Config = nconf.get('forceBridge');
  await startRelayer(cfg);
}
