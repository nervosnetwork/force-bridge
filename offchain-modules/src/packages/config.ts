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

export interface ScriptItem {
  code_hash: string;
  hash_type: HashType;
  args: string;
}

export interface MultisigItem {
  R: number;
  M: number;
  publicKeyHashes: string[];
}

export interface CkbConfig {
  ckbRpcUrl: string;
  ckbIndexerUrl: string;
  fromPrivateKey: string;
  keys: string[];
  multisigScript: MultisigItem;
  multisigType: ScriptItem;
  ownerLockHash: string;
  deps: {
    bridgeLock: ConfigItem;
    recipientType: ConfigItem;
    sudtType: ConfigItem;
    pwLocks: ConfigItem;
  };
  startBlockHeight: number;
}

export interface EthConfig {
  rpcUrl: string;
  contractAddress: string;
  privateKey: string;
  multiSignKeys: string[];
  multiSignThreshold: number;
  confirmNumber: number;
  startBlockHeight: number;
}

export interface EosConfig {
  rpcUrl: string;
  chainId: string;
  bridgerAccount: string;
  bridgerAccountPermission: string;
  publicKeys: string[];
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
  corsOptions?: {
    origin: string;
    methods?: string;
    preflightContinue?: boolean;
    optionsSuccessStatus?: number;
  };
}

export interface Config {
  ckb: CkbConfig;
  eth?: EthConfig;
  eos?: EosConfig;
  tron?: TronConfig;
  btc?: BtcConfig;
  rpc?: rpcConfig;
}
