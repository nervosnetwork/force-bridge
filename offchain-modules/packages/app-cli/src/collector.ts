import { startRelayer } from '@force-bridge/app-relayer/dist/relayer';
import { nonNullable } from '@force-bridge/x';
import commander from 'commander';

const defaultConfig = './config.json';

export const relayerCmd = new commander.Command('collector')
  .option('-cfg, --config <config>', 'config path of replayer', defaultConfig)
  .action(sigServer);

async function sigServer(opts: Record<string, string>) {
  const configPath = nonNullable(opts.config || defaultConfig);
  await startRelayer(configPath);
}
