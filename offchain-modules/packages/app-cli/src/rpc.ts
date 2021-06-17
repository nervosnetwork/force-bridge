import { startRpcServer } from '@force-bridge/app-rpc-server/dist/server';
import { Config } from '@force-bridge/x/dist/config';
import commander from 'commander';
import nconf from 'nconf';
import { parseOptions } from './utils';

const defaultPort = '8080';
const defaultCorsOrigin = '*';
const defaultConfig = './config.json';

export const rpcCmd = new commander.Command('rpc')
  .option('-p, --port', `Rpc server listen port default:${defaultPort}`, defaultPort)
  .option('-co, --corsOrigin', `cors options of origin default:${defaultCorsOrigin}`, defaultCorsOrigin)
  .option('-cfg, --config', `config path of rpc server default:${defaultConfig}`, defaultConfig)
  .action(rpc);

async function rpc(command: commander.Command, args: any) {
  const opts = command.opts();
  const options = parseOptions(opts, args);
  const port = options.get('port') !== undefined ? options.get('port') : defaultPort;
  const corsOrigin = options.get('corsOrigin') || defaultCorsOrigin;
  const configPath = options.get('config') !== undefined ? options.get('config') : defaultConfig;
  nconf.env().file({ file: configPath });
  const cfg: Config = nconf.get('forceBridge');

  cfg.rpc = {
    port: Number(port),
    corsOptions: {
      origin: corsOrigin,
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
      preflightContinue: false,
      optionsSuccessStatus: 200,
    },
  };
  await startRpcServer(cfg);
}
