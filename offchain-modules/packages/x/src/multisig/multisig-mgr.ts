import { key } from '@ckb-lumos/hd';
import { TransactionSkeletonObject } from '@ckb-lumos/helpers';
import * as utils from '@nervosnetwork/ckb-sdk-utils';
import { JSONRPCResponse } from 'json-rpc-2.0';
import { MultiSignHost } from '../config';
import { ForceBridgeCore } from '../core';
import { asyncSleep } from '../utils';
import { logger } from '../utils/logger';
import { EthUnlockRecord } from '../xchain/eth';
import { httpRequest } from './client';
import { verifyCollector } from './utils';

const SigErrorTxNotFound = 1003;
const SigErrorTxUnconfirmed = 1004;
const SigErrorBlockSyncUncompleted = 1005;
const SigErrorTxCompleted = 1006;
const SigErrorCodeUnknownError = 9999;

const retryErrorCode = new Set<number>()
  .add(SigErrorTxNotFound)
  .add(SigErrorTxUnconfirmed)
  .add(SigErrorBlockSyncUncompleted)
  .add(SigErrorCodeUnknownError);

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
  sudtExtraData: string;
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

export type collectSignaturesParamsPayload = ethCollectSignaturesPayload | ckbCollectSignaturesPayload;

export interface collectSignaturesParams {
  rawData: string;
  requestAddress?: string;
  payload: collectSignaturesParamsPayload;
  collectorSig?: string;
}

export interface getPendingTxParams {
  chain: string;
}

function signToCollectSignaturesParams(params: collectSignaturesParams): void {
  params.collectorSig = '';
  const rawData = JSON.stringify(params, undefined);
  const data = Buffer.from(rawData, 'utf8').toString('hex');
  const message = '0x' + utils.blake160('0x' + data, 'hex');
  params.collectorSig = key.signRecoverable(message, ForceBridgeCore.config.ckb.privateKey);
}

export class MultiSigMgr {
  private readonly chainType: string;
  private readonly sigServerHosts: MultiSignHost[];
  private readonly threshold: number;
  constructor(chainType: string, sigServerHosts: MultiSignHost[], threshold: number) {
    this.chainType = chainType;
    this.sigServerHosts = sigServerHosts;
    this.threshold = threshold;
  }

  public async collectSignatures(params: collectSignaturesParams): Promise<string[] | boolean> {
    logger.info(
      `collectSignatures chain:${this.chainType} rawData:${params.rawData} payload:${JSON.stringify(params.payload)}`,
    );

    const sigs: { svrHost: MultiSignHost; signature: string; timeCost: number }[] = [];
    let sigServerHosts = this.sigServerHosts;
    const txCompletedMap = new Map<string, boolean>();
    const startTime = new Date().getTime();
    for (;;) {
      if (sigServerHosts.length === 0) {
        break;
      }
      const failedSigServerHosts: MultiSignHost[] = [];
      const sigPromises = sigServerHosts.map((svrHost) => {
        return new Promise((resolve) => {
          params.requestAddress = svrHost.address;
          //collector sign to rawData;
          signToCollectSignaturesParams(params);
          this.requestSig(svrHost.host, params).then(
            (value) => {
              resolve({ svrHost: svrHost, sigResp: value, timeCost: new Date().getTime() - startTime });
            },
            (err) => {
              logger.error(
                `MultiSigMgr collectSignatures chain:${this.chainType} address:${svrHost.address} rawData:${
                  params.rawData
                } payload:${JSON.stringify(params.payload)} sigServer:${svrHost.host}, error:${err.message}`,
              );
              failedSigServerHosts.push(svrHost);
              resolve(null);
            },
          );
        });
      });

      const sigResponses = await Promise.all(sigPromises);
      for (const value of sigResponses) {
        if (value === null) {
          continue;
        }
        const promiseResult = value as { svrHost: MultiSignHost; sigResp: JSONRPCResponse; timeCost: number };
        const sigResp = promiseResult.sigResp;
        const svrHost = promiseResult.svrHost;
        if (sigResp.error) {
          const errorCode = sigResp.error.code;
          const errorMsg = `MultiSigMgr collectSignatures chain:${this.chainType} address:${svrHost.address} rawData:${
            params.rawData
          } payload:${JSON.stringify(params.payload)} sigServer:${svrHost.host}, errorCode:${errorCode} errorMessage:${
            sigResp.error.message
          }`;

          if (retryErrorCode.has(errorCode)) {
            failedSigServerHosts.push(svrHost);
            logger.warn(errorMsg);
          } else {
            logger.error(errorMsg);
          }

          if (sigResp.error.code === SigErrorTxCompleted) {
            txCompletedMap.set(svrHost.host, true);
            if (txCompletedMap.size >= this.threshold) {
              return true;
            }
          }
          continue;
        }
        const sig = sigResp.result as string;
        sigs.push({ svrHost: svrHost, signature: sig, timeCost: promiseResult.timeCost });
        logger.info(
          `MultiSigMgr collectSignatures chain:${this.chainType} address:${svrHost.address} rawData:${params.rawData} sigServer:${svrHost.host} sig:${sig}`,
        );
      }
      if (sigs.length >= this.threshold) {
        sigs.sort((a, b) => {
          return a.timeCost - b.timeCost;
        });
        const minCostSignatures = sigs.slice(0, this.threshold);
        logger.info(
          `MultiSigMgr collectSignatures success, chain:${this.chainType} rawData:${
            params.rawData
          } sigServers:${minCostSignatures
            .map((sig) => {
              return sig.svrHost.host;
            })
            .join(',')}`,
        );
        return minCostSignatures.map((sig) => {
          return sig.signature;
        });
      }
      //retry failed hosts
      sigServerHosts = failedSigServerHosts;
      await asyncSleep(15000);
    }
    return sigs.map((sig) => {
      return sig.signature;
    });
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
                if (!verifyCollector(resp.result)) {
                  logger.warn(`getPendingTx invalid pendingTx, pendingTx:${resp.result}`);
                  return resolve(null);
                }
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
