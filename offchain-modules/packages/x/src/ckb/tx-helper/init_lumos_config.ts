import path from 'path';
import { initializeConfig } from '@ckb-lumos/config-manager';

export type LumosConfigType = 'LINA' | 'AGGRON4' | 'DEV';

export function initLumosConfig(env: LumosConfigType = 'DEV'): void {
  if (env === 'DEV') {
    const configFilePath = path.join(__dirname, 'generated/devnet-lumos-config.json');
    process.env.LUMOS_CONFIG_FILE = configFilePath;
  } else if (env === 'LINA' || env === 'AGGRON4') {
    process.env.LUMOS_CONFIG_NAME = env;
  } else {
    throw new Error(`wrong LumosConfigType ${env}`);
  }
  initializeConfig();
}
