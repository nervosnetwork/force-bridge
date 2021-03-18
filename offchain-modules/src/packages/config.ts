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

export interface TronConfig {
  privateKey: string;
  tronGridUrl: string;
  committee: {
    address: string;
    permissionId: string;
    keys: string[];
  };
}

export interface Config {
  ckb: CkbConfig;
  eth?: EthConfig;
  tron?: TronConfig;
}
