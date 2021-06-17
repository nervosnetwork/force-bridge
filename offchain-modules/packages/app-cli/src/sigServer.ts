import { startSigServer } from '@force-bridge/app-multisign-server/dist/sigServer';
import { Config } from '@force-bridge/x/dist/config';
import commander from 'commander';
import nconf from 'nconf';
import { parseOptions } from './utils';

const defaultPort = '8090';
const defaultConfig = './config.json';

export const sigCmd = new commander.Command('signer')
  .option('-p, --port', `Sig server listen port default:${defaultPort}`, defaultPort)
  .option('-cfg, --config', `config path of sig server default:${defaultConfig}`, defaultConfig)
  .action(sigServer);

async function sigServer(command: commander.Command, args: any) {
  const opts = command.opts();
  const options = parseOptions(opts, args);
  const port = options.get('port') !== undefined ? options.get('port') : defaultPort;
  const configPath = options.get('config') !== undefined ? options.get('config') : defaultConfig;
  nconf.env().file({ file: configPath });
  const cfg: Config = nconf.get('forceBridge');
  await startSigServer(cfg, Number(port));
}
