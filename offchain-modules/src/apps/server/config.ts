import { ConfigItem, MultisigItem, ScriptItem } from '@force-bridge/config';

export interface EthConfig {
  rpcUrl: string;
  contractAddress: string;
}

export interface CkbConfig {
  multisigScript: MultisigItem;
  multisigType: ScriptItem;
  deps: {
    bridgeLock: ConfigItem;
    recipientType: ConfigItem;
    sudtType: ConfigItem;
  };
}

export interface Config {
  eth?: EthConfig;
  ckb?: CkbConfig;
}
