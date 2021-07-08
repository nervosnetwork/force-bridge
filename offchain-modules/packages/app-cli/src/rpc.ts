import { startRpcServer } from '@force-bridge/app-rpc-server/dist/server';
import { nonNullable } from '@force-bridge/x';
import { bootstrap, ForceBridgeCore } from '@force-bridge/x/dist/core';
import commander from 'commander';

const defaultCorsOrigin = '*';
const defaultConfig = './config.json';

export const rpcCmd = new commander.Command('rpc')
  .option('-co, --corsOrigin <corsOrigin>', 'cors options of origin', defaultCorsOrigin)
  .option('-cfg, --config <config>', 'config path of rpc server', defaultConfig)
  .action(rpc);

async function rpc(opts: Record<string, string>) {
  const corsOrigin = nonNullable(opts.corsOrigin || defaultCorsOrigin);
  const configPath = nonNullable(opts.config || defaultConfig);
  await bootstrap(configPath);
  ForceBridgeCore.config.rpc = {
    corsOptions: {
      origin: corsOrigin,
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
      preflightContinue: false,
      optionsSuccessStatus: 200,
    },
  };
  await startRpcServer(configPath);
}
