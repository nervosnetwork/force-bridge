import nconf from 'nconf';
import { ForceBridgeCore } from '../../packages/core';
import { Config } from '../../packages/config';

export async function initConfig() {
  const configPath = process.env.CONFIG_PATH || './config-cli.json';
  nconf.env().file({ file: configPath });
  const config: Config = nconf.get('forceBridge');
  await new ForceBridgeCore().init(config);
}

export function parseOptions(args: any, command: any): Map<string, string> {
  const values = command.args;
  const optionMap = new Map();
  const options = Object.keys(args);
  for (const i in options) {
    optionMap.set(options[i], values[i]);
  }
  return optionMap;
}
