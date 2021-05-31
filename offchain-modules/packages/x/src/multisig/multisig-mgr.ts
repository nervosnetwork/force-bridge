import { TransactionSkeletonType } from '@ckb-lumos/helpers';
import { MultiSignHost } from '../config';
import { logger } from '../utils/logger';
import { EthUnlockRecord } from '../xchain/eth';
import { httpRequest } from './client';

export interface ethCollectSignaturesPayload {
  domainSeparator: string;
  typeHash: string;
  unlockRecords: EthUnlockRecord[];
  nonce: number;
}

export type SigType = 'mint' | 'create_cell' | 'unlock';

export interface mintRecord {
  id: string;
  chain: number;
  asset: string;
  amount: string;
  recipientLockscript: string;
}

export interface createAsset {
  chain: number;
  asset: string;
}

export interface ckbCollectSignaturesPayload {
  sigType: SigType;
  mintRecords?: mintRecord[];
  createAssets?: createAsset[];
  txSkeleton: TransactionSkeletonType;
}

export interface collectSignaturesParams {
  rawData: string;
  requestAddress?: string;
  payload: ethCollectSignaturesPayload | ckbCollectSignaturesPayload;
  lastFailedTxHash?: string;
}

export class MultiSigMgr {
  private chainType: string;
  private sigServerHosts: MultiSignHost[];
  private threshold: number;
  constructor(chainType: string, sigServerHosts: MultiSignHost[], threshold: number) {
    this.chainType = chainType;
    this.sigServerHosts = sigServerHosts;
    this.threshold = threshold;
  }

  public async collectSignatures(params: collectSignaturesParams): Promise<string[]> {
    logger.info(
      `collectSignatures chain:${this.chainType} rawData:${params.rawData} payload:${JSON.stringify(
        params.payload,
        null,
        2,
      )}`,
    );
    const successSigSvr = [];
    const sigs = [];
    for (const svrHost of this.sigServerHosts) {
      try {
        params.requestAddress = svrHost.address;
        const sig = await this.requestSig(svrHost.host, params);
        sigs.push(sig);
        successSigSvr.push(svrHost.host);
        logger.info(
          `MultiSigMgr collectSignatures chain:${this.chainType} address:${svrHost.address} rawData:${
            params.rawData
          } sigServer:${svrHost.host} sig:${sig.toString()}`,
        );
      } catch (e) {
        logger.error(
          `MultiSigMgr collectSignatures chain:${this.chainType} address:${svrHost.address} rawData:${
            params.rawData
          } payload:${JSON.stringify(params.payload, null, 2)} sigServer:${svrHost.host}, error:${e.message}`,
        );
      }
      if (successSigSvr.length === this.threshold) {
        logger.info(
          `MultiSigMgr collectSignatures success, chain:${this.chainType} address:${svrHost.address} rawData:${
            params.rawData
          } sigServers:${successSigSvr.join(',')}`,
        );
        break;
      }
    }
    return sigs;
  }

  public async requestSig(host: string, params: collectSignaturesParams): Promise<string> {
    let method: string;
    switch (this.chainType) {
      case 'CKB':
        method = 'signCkbTx';
        break;
      case 'ETH':
        method = 'signEthTx';
        break;
      default:
        return Promise.reject(new Error(`chain type:${this.chainType} doesn't support`));
    }
    return httpRequest(host, method, params);
  }
}
