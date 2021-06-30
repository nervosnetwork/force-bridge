import { startSigServer } from '@force-bridge/app-multisign-server/dist/sigServer';
import { nonNullable } from '@force-bridge/x';
import { Config } from '@force-bridge/x/dist/config';
import commander from 'commander';
import nconf from 'nconf';

const defaultPort = '8090';
const defaultConfig = './config.json';

export const sigCmd = new commander.Command('signer')
  .option('-p, --port <port>', 'Sig server listen port', defaultPort)
  .option('-cfg, --config <config>', 'config path of sig server', defaultConfig)
  .action(sigServer);

async function sigServer(opts: Record<string, string>) {
  const port = nonNullable(opts.port || defaultPort);
  const configPath = nonNullable(opts.config || defaultConfig);
  nconf.env().file({ file: configPath });
  const cfg: Config = nconf.get('forceBridge');
  await startSigServer(cfg, Number(port));
}
