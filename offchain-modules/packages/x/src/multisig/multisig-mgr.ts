import { httpRequest } from '@force-bridge/multisig/client';
import { logger } from '@force-bridge/utils/logger';
import { EthUnlockRecord } from '@force-bridge/xchain/eth';
import { TransactionSkeletonType } from '@ckb-lumos/helpers';

export interface ethCollectSignaturesPayload {
  domainSeparator: string;
  typeHash: string;
  unlockRecords: EthUnlockRecord[];
  nonce: number;
}

export type ckbSigType = 'mint' | 'create_cell';

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
  sigType: ckbSigType;
  mintRecords?: mintRecord[];
  createAssets?: createAsset[];
  txSkeleton: TransactionSkeletonType;
}

export interface collectSignaturesParams {
  rawData: string;
  payload: ethCollectSignaturesPayload | ckbCollectSignaturesPayload;
  failedTxHash?: string;
}

export class MultiSigMgr {
  private chainType: string;
  private sigServerHosts: string[];
  private threshold: number;
  constructor(chainType: string, sigServerHosts: string[], threshold: number) {
    this.chainType = chainType;
    this.sigServerHosts = sigServerHosts;
    this.threshold = threshold;
  }

  public async collectSignatures(params: collectSignaturesParams): Promise<string[]> {
    logger.info(`collectSignatures rawData:${params.rawData} payload:${JSON.stringify(params.payload, null, 2)}`);
    let successSigSvr = [];
    let sigs = [];
    for (const svrHost of this.sigServerHosts) {
      try {
        const sig = await this.requestSig(svrHost, params);
        sigs.push(sig);
        successSigSvr.push(svrHost);
        logger.info(
          `MultiSigMgr collectSignatures rawData:${params.rawData} sigServer:${svrHost} sig:${sig.toString()}`,
        );
      } catch (e) {
        logger.error(
          `MultiSigMgr collectSignatures rawData:${params.rawData} sigServer:${svrHost}, error:${e.message}`,
        );
      }
      if (successSigSvr.length === this.threshold) {
        logger.info(
          `MultiSigMgr collectSignatures success, rawData:${params.rawData} sigServers:${successSigSvr.join(',')}`,
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
