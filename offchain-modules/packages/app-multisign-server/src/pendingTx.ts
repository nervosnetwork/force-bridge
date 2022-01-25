import {
  ckbCollectSignaturesPayload,
  ckbMintCollectSignaturesPayload,
  ckbUnlockCollectSignaturesPayload,
  collectSignaturesParams,
  ethCollectSignaturesPayload,
  getPendingTxParams,
} from '@force-bridge/x/dist/multisig/multisig-mgr';
import { BigNumber } from 'ethers';
import { SigErrorCode } from './error';
import { SigResponse, SigServer } from './sigServer';

export type getPendingTxResult = collectSignaturesParams | undefined;

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
  const pendingTx = await SigServer.getPendingTx('ckb');
  if (pendingTx === undefined) {
    return SigResponse.fromData(undefined);
  }
  const ckbPayload = (pendingTx as collectSignaturesParams).payload as ckbCollectSignaturesPayload;
  if (ckbPayload.sigType === 'mint') {
    const records = await SigServer.ckbDb.getCkbMintByIds([
      (ckbPayload as ckbMintCollectSignaturesPayload).mintRecords![0].id,
    ]);
    if (records.length > 0) {
      return SigResponse.fromData(undefined);
    }
  } else if (ckbPayload.sigType === 'unlock') {
    const records = await SigServer.ckbDb.getCkbUnlockByIds([
      (ckbPayload as ckbUnlockCollectSignaturesPayload).unlockRecords![0].id,
    ]);
    if (records.length > 0) {
      return SigResponse.fromData(undefined);
    }
  }
  return SigResponse.fromData(pendingTx);
}

async function getEthPendingTx(): Promise<SigResponse> {
  const pendingTx = await SigServer.getPendingTx('eth');
  if (pendingTx === undefined) {
    return SigResponse.fromData(undefined);
  }
  const ethPayload = (pendingTx as collectSignaturesParams).payload as ethCollectSignaturesPayload;
  const nonce: BigNumber = await SigServer.ethBridgeContract.latestUnlockNonce_();
  if (nonce.toNumber() > ethPayload.nonce) {
    return SigResponse.fromData(undefined);
  }
  return SigResponse.fromData(pendingTx);
}
