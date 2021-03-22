import { DepType, HashType } from '@lay2/pw-core';

export interface ConfigItem {
  cellDep: {
    depType: DepType;
    outPoint: {
      txHash: string;
      index: string;
    };
  };
  script: {
    codeHash: string;
    hashType: HashType;
    args?: string;
  };
}

export interface CkbConfig {
  ckbRpcUrl: string;
  ckbIndexerUrl: string;
  deps: {
    bridgeLock: ConfigItem;
    recipientType: ConfigItem;
    sudtType: ConfigItem;
  };
}

export interface EthConfig {
  rpcUrl: string;
  contractAddress: string;
  privateKey: string;
}

export interface BtcConfig {
  clientParams: {
    url: string;
    user: string;
    pass: string;
    port: number;
    timeout?: number;
  };
  privateKeys: string[];
  lockAddress: string;
}

export interface Config {
  ckb: CkbConfig;
  eth?: EthConfig;
  btc?: BtcConfig;
}
