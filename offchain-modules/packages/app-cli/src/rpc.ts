import { startRpcServer } from '@force-bridge/app-rpc-server/dist/server';
import { nonNullable } from '@force-bridge/x';
import commander from 'commander';
import { bootstrap, ForceBridgeCore } from '@force-bridge/x/dist/core';

const defaultPort = '8080';
const defaultCorsOrigin = '*';
const defaultConfig = './config.json';

export const rpcCmd = new commander.Command('rpc')
  .option('-p, --port <port>', 'Rpc server listen port', defaultPort)
  .option('-co, --corsOrigin <corsOrigin>', 'cors options of origin', defaultCorsOrigin)
  .option('-cfg, --config <config>', 'config path of rpc server', defaultConfig)
  .action(rpc);

async function rpc(opts: Record<string, string>) {
  const port = nonNullable(opts.port || defaultPort);
  const corsOrigin = nonNullable(opts.corsOrigin || defaultCorsOrigin);
  const configPath = nonNullable(opts.config || defaultConfig);
  await bootstrap(configPath);
  ForceBridgeCore.config.rpc = {
    port: Number(port),
    corsOptions: {
      origin: corsOrigin,
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
      preflightContinue: false,
      optionsSuccessStatus: 200,
    },
  };
  await startRpcServer(configPath);
}
