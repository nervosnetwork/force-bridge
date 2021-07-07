import { TransactionSkeletonObject } from '@ckb-lumos/helpers';
import { JSONRPCResponse } from 'json-rpc-2.0';
import { MultiSignHost } from '../config';
import { asyncSleep } from '../utils';
import { logger } from '../utils/logger';
import { EthUnlockRecord } from '../xchain/eth';
import { httpRequest } from './client';

const SigErrorTxNotFound = 1003;
const SigErrorTxUnconfirmed = 1004;
const SigErrorBlockSyncUncompleted = 1005;
const SigErrorTxCompleted = 1006;
const SigErrorCodeUnknownError = 9999;

const retryErrorCode = new Map<number, boolean>([
  [SigErrorTxNotFound, true],
  [SigErrorTxUnconfirmed, true],
  [SigErrorBlockSyncUncompleted, true],
  [SigErrorCodeUnknownError, true],
]);

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
  txSkeleton: TransactionSkeletonObject;
}

export interface collectSignaturesParams {
  rawData: string;
  requestAddress?: string;
  payload: ethCollectSignaturesPayload | ckbCollectSignaturesPayload;
}

export interface getPendingTxParams {
  chain: string;
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

  public async collectSignatures(params: collectSignaturesParams): Promise<string[] | boolean> {
    logger.info(
      `collectSignatures chain:${this.chainType} rawData:${params.rawData} payload:${JSON.stringify(
        params.payload,
        null,
        2,
      )}`,
    );
    const successSigSvr: string[] = [];
    const sigs: string[] = [];
    let sigServerHosts = this.sigServerHosts;
    const txCompletedMap = new Map<string, boolean>();
    for (;;) {
      if (sigServerHosts.length === 0) {
        break;
      }
      const failedSigServerHosts: MultiSignHost[] = [];
      for (const svrHost of sigServerHosts) {
        params.requestAddress = svrHost.address;
        try {
          const sigResp = await this.requestSig(svrHost.host, params);
          if (sigResp.error) {
            if (retryErrorCode.get(sigResp.error.code)) {
              failedSigServerHosts.push(svrHost);
            }
            if (sigResp.error.code === SigErrorTxCompleted) {
              txCompletedMap.set(svrHost.host, true);
              logger.warn(
                `MultiSigMgr collectSignatures chain:${this.chainType} address:${svrHost.address} rawData:${
                  params.rawData
                } payload:${JSON.stringify(params.payload, null, 2)} sigServer:${svrHost.host}, errorCode:${
                  sigResp.error.code
                } errorMessage:${sigResp.error.message}`,
              );
              if (txCompletedMap.size >= this.threshold) {
                return true;
              }
            } else {
              logger.error(
                `MultiSigMgr collectSignatures chain:${this.chainType} address:${svrHost.address} rawData:${
                  params.rawData
                } payload:${JSON.stringify(params.payload, null, 2)} sigServer:${svrHost.host}, errorCode:${
                  sigResp.error.code
                } errorMessage:${sigResp.error.message}`,
              );
            }
            continue;
          }
          const sig = sigResp.result as string;
          sigs.push(sig);
          successSigSvr.push(svrHost.host);
          logger.info(
            `MultiSigMgr collectSignatures chain:${this.chainType} address:${svrHost.address} rawData:${
              params.rawData
            } sigServer:${svrHost.host} sig:${sig.toString()}`,
          );
          if (successSigSvr.length === this.threshold) {
            logger.info(
              `MultiSigMgr collectSignatures success, chain:${this.chainType} address:${svrHost.address} rawData:${
                params.rawData
              } sigServers:${successSigSvr.join(',')}`,
            );
            return sigs;
          }
        } catch (e) {
          logger.error(
            `MultiSigMgr collectSignatures chain:${this.chainType} address:${svrHost.address} rawData:${
              params.rawData
            } payload:${JSON.stringify(params.payload, null, 2)} sigServer:${svrHost.host}, error:${e.message}`,
          );
          failedSigServerHosts.push(svrHost);
        }
      }
      sigServerHosts = failedSigServerHosts;
      await asyncSleep(3000);
    }
    return sigs;
  }

  public async requestSig(host: string, params: collectSignaturesParams): Promise<JSONRPCResponse> {
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

  public async getPendingTx(params: getPendingTxParams): Promise<collectSignaturesParams | undefined> {
    const pendingTxPromises = this.sigServerHosts.map((svr) => {
      return new Promise((resolve) => {
        httpRequest(svr.host, 'pendingTx', params).then(
          (value) => {
            const resp = value as JSONRPCResponse;
            if (resp.error) {
              logger.error(`getPendingTx host:${svr.host} response error:${resp.error}`);
              return resolve(null);
            } else {
              if (resp.result) {
                return resolve(value);
              }
              return resolve(null);
            }
          },
          (err) => {
            logger.error(`getPendingTx host:${svr.host} error:${err.message}`);
            resolve(null);
          },
        );
      });
    });

    const pendingTxs = (await Promise.all(pendingTxPromises)).filter((pendingTx) => {
      return pendingTx !== null;
    });
    switch (pendingTxs.length) {
      case 0:
        return undefined;
      case 1:
        return (pendingTxs[0] as JSONRPCResponse).result;
    }

    const pendingMap = new Map<string, { count: number; pendingTx: collectSignaturesParams }>();
    pendingTxs.forEach((pendingTx) => {
      const pendingTxResp = pendingTx as JSONRPCResponse;
      const pendingTxObj = pendingTxResp.result as collectSignaturesParams;
      const pendingTxCount = pendingMap.get(pendingTxObj.rawData);
      if (pendingTxCount) {
        pendingTxCount.count++;
        pendingMap.set(pendingTxObj.rawData, pendingTxCount);
      } else {
        pendingMap.set(pendingTxObj.rawData, { count: 0, pendingTx: pendingTxObj });
      }
    });

    const maxCount = -1;
    let pendingTx: collectSignaturesParams | undefined = undefined;
    pendingMap.forEach((val) => {
      if (val.count > maxCount) {
        pendingTx = val.pendingTx;
      }
    });
    return pendingTx;
  }
}
