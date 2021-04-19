import { existsSync } from 'fs';
import { initializeConfig } from '@ckb-lumos/config-manager';

export function init() {
  const configFilePath = __dirname + '/config.json';
  if (
    process.env.LUMOS_CONFIG_NAME !== 'LINA' &&
    process.env.LUMOS_CONFIG_NAME !== 'AGGRON4' &&
    existsSync(configFilePath)
  ) {
    process.env.LUMOS_CONFIG_FILE = configFilePath;
  }
  console.log(process.env.LUMOS_CONFIG_FILE);
  initializeConfig();
}
