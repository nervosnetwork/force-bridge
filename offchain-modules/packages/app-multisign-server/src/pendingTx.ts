import * as fs from 'fs';
import {
  ckbCollectSignaturesPayload,
  ethCollectSignaturesPayload,
  getPendingTxParams,
} from '@force-bridge/x/dist/multisig/multisig-mgr';
import { BigNumber } from 'ethers';
import { ckbPendingTxFileName } from './ckbSigner';
import { SigErrorCode } from './error';
import { ethPendingTxFileName } from './ethSigner';
import { SigResponse, SigServer } from './sigServer';

export type getPendingTxResult = ethCollectSignaturesPayload | ckbCollectSignaturesPayload | undefined;

export async function getPendingTx(params: getPendingTxParams): Promise<SigResponse> {
  switch (params.chain) {
    case 'ckb':
      return getCkbPendingTx();
      break;
    case 'eth':
      return getEthPendingTx();
      break;
    default:
      return SigResponse.fromSigError(SigErrorCode.InvalidParams, `chain:${params.chain} doesn't support`);
  }
}

async function getCkbPendingTx(): Promise<SigResponse> {
  const payload = readPendingTx(ckbPendingTxFileName);
  if (payload === undefined) {
    return SigResponse.fromData(undefined);
  }
  const ckbPayload = payload as ckbCollectSignaturesPayload;
  const mintRecords = await SigServer.ckbDb.getCkbMintByLockTxHashes([ckbPayload.mintRecords![0].id]);
  if (mintRecords.length > 0) {
    return SigResponse.fromData(undefined);
  }
  return SigResponse.fromData(payload);
}

async function getEthPendingTx(): Promise<SigResponse> {
  const payload = readPendingTx(ethPendingTxFileName);
  if (payload === undefined) {
    return SigResponse.fromData(undefined);
  }
  const ethPayload = payload as ethCollectSignaturesPayload;
  const nonce: BigNumber = await SigServer.ethBridgeContract.latestUnlockNonce_();
  if (nonce.toNumber() > ethPayload.nonce) {
    return SigResponse.fromData(undefined);
  }
  return SigResponse.fromData(payload);
}

function readPendingTx(fileName: string): getPendingTxResult {
  if (!fs.existsSync(fileName)) {
    return undefined;
  }
  return JSON.parse(fs.readFileSync(fileName, 'utf8'));
}
