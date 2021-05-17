import { ConfigItem, MultisigItem, ScriptItem } from '@force-bridge/config';

export interface EthConfig {
  rpcUrl: string;
  contractAddress: string;
  multiSignKeys: string[];
}

export interface CkbConfig {
  ckbRpcUrl: string;
  keys: string[];
  multisigScript: MultisigItem;
  multisigType: ScriptItem;
  deps: {
    bridgeLock: ConfigItem;
    recipientType: ConfigItem;
    sudtType: ConfigItem;
  };
}

export interface SigServerConfig {
  eth?: EthConfig;
  ckb?: CkbConfig;
}
