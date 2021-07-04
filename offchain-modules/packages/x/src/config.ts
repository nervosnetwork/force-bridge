import { DepType, HashType } from '@lay2/pw-core';

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

export class MultiSignHost {
  address: string;
  host: string;
}

export class MultiSignKey {
  /**
   * @deprecated migrate to {@link KeyStore}
   */
  privKey: string;
  address: string;
}

export interface CkbConfig {
  ckbRpcUrl: string;
  ckbIndexerUrl: string;
  /**
   * @deprecated migrate to {@link ForceBridgeCore}.keystore.get('ckb')
   */
  fromPrivateKey: string;
  /**
   * @deprecated migrate to {@link ForceBridgeCore}.keystore.get('ckb-multisig') or {@link ForceBridgeCore}.keystore.get('ckb-multisig-n')
   */
  multiSignKeys: MultiSignKey[];
  multiSignHosts: MultiSignHost[];
  multisigScript: MultisigItem;
  multisigLockscript: ScriptItem;
  ownerCellTypescript: ScriptItem;
  deps: {
    bridgeLock: ConfigItem;
    recipientType: ConfigItem;
    sudtType: ConfigItem;
  };
  startBlockHeight: number;
  confirmNumber: number;
}

export interface EthConfig {
  rpcUrl: string;
  contractAddress: string;
  /**
   * @deprecated migrate to {@link KeyStore}.keystore.get('eth')
   */
  privateKey: string;
  /**
   * @deprecated migrate to {@link KeyStore}.keystore.get('eth-multisig') or {@link ForceBridgeCore}.keystore.get('eth-multisig-n')
   */
  multiSignKeys: MultiSignKey[];
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

export interface rpcConfig {
  port: number;
  corsOptions?: {
    origin: string;
    methods?: string;
    preflightContinue?: boolean;
    optionsSuccessStatus?: number;
  };
}

export interface logConfig {
  level: string;
  logFile?: string;
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
  port?: number;
  orm: ormConfig;
  monitor?: promConfig;
  keystorePath?: string;
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

export interface Config {
  common: commonConfig;
  ckb: CkbConfig;
  eth: EthConfig;
  eos: EosConfig;
  tron: TronConfig;
  btc: BtcConfig;
  rpc: rpcConfig;
}
