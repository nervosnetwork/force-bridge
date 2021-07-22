import { DepType, HashType, Script } from '@ckb-lumos/base';

export type forceBridgeRole = 'watcher' | 'collector' | 'verifier';

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

export interface MultisigItem {
  R: number;
  M: number;
  publicKeyHashes: string[];
}

export class MultiSignHost {
  address: string;
  host: string;
}

export interface CkbDeps {
  bridgeLock: ConfigItem;
  recipientType: ConfigItem;
  sudtType: ConfigItem;
}

export interface CkbConfig {
  ckbRpcUrl: string;
  ckbIndexerUrl: string;
  privateKey: string;
  multiSignHosts: MultiSignHost[];
  multisigScript: MultisigItem;
  multisigLockscript: Script;
  ownerCellTypescript: Script;
  deps: CkbDeps;
  startBlockHeight: number;
  confirmNumber: number;
  sudtSize: number;
}

export interface EthConfig {
  rpcUrl: string;
  contractAddress: string;
  privateKey: string;
  multiSignAddresses: string[];
  multiSignHosts: MultiSignHost[];
  multiSignThreshold: number;
  confirmNumber: number;
  startBlockHeight: number;
  batchUnlock: { batchNumber: number; maxWaitTime: number };
  assetWhiteList: WhiteListEthAsset[];
}

export interface EosConfig {
  rpcUrl: string;
  chainId: string;
  bridgerAccount: string;
  bridgerAccountPermission: string;
  publicKeys: string[];
  /**
   * @deprecated migrate to {@link KeyStore}
   */
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
  /**
   * @deprecated migrate to {@link KeyStore}
   */
  privateKeys: string[];
  lockAddress: string;
  startBlockHeight: number;
  confirmNumber: number;
}

export interface logConfig {
  level: string;
  logFile?: string;
  identity?: string;
}

export type ormDBType = 'mysql';

export interface ormConfig {
  type: ormDBType;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  timezone: string;
  synchronize: boolean;
  logging: boolean;
}

export interface commonConfig {
  role: forceBridgeRole;
  log: logConfig;
  network: 'mainnet' | 'testnet';
  lumosConfigType: 'LINA' | 'AGGRON4' | 'DEV';
  port?: number;
  orm: ormConfig;
  openMetric: boolean;
  keystorePath?: string;
  collectorPubKeyHash: string[];
}

export interface promConfig {
  metricPort: number;
}

export interface WhiteListEthAsset {
  address: string;
  name: string;
  symbol: string;
  logoURI: string;
  decimal: number;
  minimalBridgeAmount: string;
  bridgeFee: { in: string; out: string };
}

export interface collectorConfig {
  gasLimit: number;
  batchGasLimit: number;
  gasPriceGweiLimit: number;
}

export interface Config {
  common: commonConfig;
  ckb: CkbConfig;
  eth: EthConfig;
  eos: EosConfig;
  tron: TronConfig;
  btc: BtcConfig;
  collector?: collectorConfig;
}
