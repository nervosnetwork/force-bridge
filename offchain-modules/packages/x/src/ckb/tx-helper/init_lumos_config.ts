import * as fs from 'fs';
import path from 'path';
import { initializeConfig, predefined, Config } from '@ckb-lumos/config-manager';

export type LumosConfigType = 'LINA' | 'AGGRON4' | 'DEV';

export function initLumosConfig(env: LumosConfigType = 'DEV'): void {
  if (env === 'DEV') {
    const configFilePath = path.join(__dirname, 'generated/devnet-lumos-config.json');
    try {
      const data = fs.readFileSync(configFilePath);
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const loadedConfig = JSON.parse(data);
      initializeConfig(loadedConfig);
    } catch (e) {
      throw new Error(`Error loading lumos dev config from file ${configFilePath}: ${e}`);
    }
  } else if (env === 'LINA' || env === 'AGGRON4') {
    // FIXME workaround to generate full address
    const config = predefined[env] as Config;
    const SECP256K1_BLAKE160_WITHOUT_SHORT_ID = {
      CODE_HASH: config.SCRIPTS.SECP256K1_BLAKE160!.CODE_HASH,
      HASH_TYPE: config.SCRIPTS.SECP256K1_BLAKE160!.HASH_TYPE,
      TX_HASH: config.SCRIPTS.SECP256K1_BLAKE160!.TX_HASH,
      INDEX: config.SCRIPTS.SECP256K1_BLAKE160!.INDEX,
      DEP_TYPE: config.SCRIPTS.SECP256K1_BLAKE160!.DEP_TYPE,
    };
    config.SCRIPTS.SECP256K1_BLAKE160 = SECP256K1_BLAKE160_WITHOUT_SHORT_ID;
    const SECP256K1_BLAKE160_MULTISIG_WITHOUT_SHORT_ID = {
      CODE_HASH: config.SCRIPTS.SECP256K1_BLAKE160_MULTISIG!.CODE_HASH,
      HASH_TYPE: config.SCRIPTS.SECP256K1_BLAKE160_MULTISIG!.HASH_TYPE,
      TX_HASH: config.SCRIPTS.SECP256K1_BLAKE160_MULTISIG!.TX_HASH,
      INDEX: config.SCRIPTS.SECP256K1_BLAKE160_MULTISIG!.INDEX,
      DEP_TYPE: config.SCRIPTS.SECP256K1_BLAKE160_MULTISIG!.DEP_TYPE,
    };
    config.SCRIPTS.SECP256K1_BLAKE160_MULTISIG = SECP256K1_BLAKE160_MULTISIG_WITHOUT_SHORT_ID;
    const ANYONE_CAN_PAY_WITHOUT_SHORT_ID = {
      CODE_HASH: config.SCRIPTS.ANYONE_CAN_PAY!.CODE_HASH,
      HASH_TYPE: config.SCRIPTS.ANYONE_CAN_PAY!.HASH_TYPE,
      TX_HASH: config.SCRIPTS.ANYONE_CAN_PAY!.TX_HASH,
      INDEX: config.SCRIPTS.ANYONE_CAN_PAY!.INDEX,
      DEP_TYPE: config.SCRIPTS.ANYONE_CAN_PAY!.DEP_TYPE,
    };
    config.SCRIPTS.ANYONE_CAN_PAY = ANYONE_CAN_PAY_WITHOUT_SHORT_ID;
    initializeConfig(config);
  } else {
    throw new Error(`wrong LumosConfigType ${env}`);
  }
}
