import { existsSync } from 'fs';
import { initializeConfig } from '@ckb-lumos/config-manager';
import path from "path";

export function initLumosConfig() {
  const configFilePath = path.join(__dirname, 'generated/devnet-lumos-config.json');
  if (
    process.env.LUMOS_CONFIG_NAME !== 'LINA' &&
    process.env.LUMOS_CONFIG_NAME !== 'AGGRON4' &&
    existsSync(configFilePath)
  ) {
    process.env.LUMOS_CONFIG_FILE = configFilePath;
  } else {
    throw new Error('should specify LUMOS_CONFIG_NAME');
  }
  initializeConfig();
}
