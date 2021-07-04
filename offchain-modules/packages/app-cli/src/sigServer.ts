import { startSigServer } from '@force-bridge/app-multisign-server/dist/sigServer';
import { nonNullable } from '@force-bridge/x';
import commander from 'commander';

const defaultConfig = './config.json';

export const sigCmd = new commander.Command('signer')
  .option('-cfg, --config <config>', 'config path of sig server', defaultConfig)
  .action(sigServer);

async function sigServer(opts: Record<string, string>) {
  const configPath = nonNullable(opts.config || defaultConfig);
  await startSigServer(configPath);
}
