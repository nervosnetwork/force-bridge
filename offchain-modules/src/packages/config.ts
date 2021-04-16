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
  privateKey: string;
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
  multiSignKeys: string[];
  multiSignThreshold: number;
}

export interface EosConfig {
  rpcUrl: string;
  chainId: string;
  bridgerAccount: string;
  bridgerAccountPermission: string;
  privateKeys: string[];
  latestGlobalActionSeq: number;
  onlyWatchIrreversibleBlock: boolean;
}

export interface TronConfig {
  tronGridUrl: string;
  committee: {
    address: string;
    permissionId: string;
    keys: string[];
  };
  feeLimit: number;
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

export interface rpcConfig {
  port: number;
}

export interface Config {
  ckb: CkbConfig;
  eth?: EthConfig;
  eos?: EosConfig;
  tron?: TronConfig;
  btc?: BtcConfig;
  rpc?: rpcConfig;
}
