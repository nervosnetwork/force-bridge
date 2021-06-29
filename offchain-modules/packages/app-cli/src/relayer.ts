import { startRelayer } from '@force-bridge/app-relayer/dist/relayer';
import { nonNullable } from '@force-bridge/x';
import { Config } from '@force-bridge/x/dist/config';
import commander from 'commander';
import nconf from 'nconf';

const defaultConfig = './config.json';

export const relayerCmd = new commander.Command('relayer')
  .option('-cfg, --config <config>', 'config path of replayer', defaultConfig)
  .action(sigServer);

async function sigServer(opts: Record<string, string>) {
  const configPath = nonNullable(opts.config || defaultConfig);
  nconf.env().file({ file: configPath });
  const cfg: Config = nconf.get('forceBridge');
  await startRelayer(cfg);
}
