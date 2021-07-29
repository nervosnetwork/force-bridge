import { startRpcServer } from '@force-bridge/app-rpc-server/dist/server';
import { nonNullable } from '@force-bridge/x';
import commander from 'commander';

const defaultConfig = './config.json';

export const rpcCmd = new commander.Command('rpc')
  .option('-cfg, --config <config>', 'config path of rpc server', defaultConfig)
  .action(rpc);

async function rpc(opts: Record<string, string>) {
  const configPath = nonNullable(opts.config || defaultConfig);
  await startRpcServer(configPath);
}
