import { ChainType } from '@force-bridge/x/dist/ckb/model/asset';
import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { ICkbBurn } from '@force-bridge/x/dist/db/model';
import { collectSignaturesParams, ethCollectSignaturesPayload } from '@force-bridge/x/dist/multisig/multisig-mgr';
import { verifyCollector } from '@force-bridge/x/dist/multisig/utils';
import { logger } from '@force-bridge/x/dist/utils/logger';
import { EthUnlockRecord } from '@force-bridge/x/dist/xchain/eth';
import { buildSigRawData } from '@force-bridge/x/dist/xchain/eth/utils';
import { ecsign, toRpcSig } from 'ethereumjs-util';
import { BigNumber } from 'ethers';
import { publicKeyCreate } from 'secp256k1';
import { SigError, SigErrorCode, SigErrorOk } from './error';
import { SigResponse, SigServer } from './sigServer';

async function verifyDuplicateEthTx(pubKey: string, payload: ethCollectSignaturesPayload): Promise<SigError> {
  const refTxHashes = payload.unlockRecords.map((record) => {
    return record.ckbTxHash;
  });

  const unlocks = await SigServer.ethDb.getEthUnlockByCkbTxHashes(refTxHashes);
  if (unlocks.length !== 0) {
    return new SigError(SigErrorCode.TxCompleted);
  }

  const nonce = await SigServer.ethBridgeContract.latestUnlockNonce_();
  if (nonce.toString() !== payload.nonce.toString()) {
    return new SigError(SigErrorCode.InvalidParams, `nonce:${payload.nonce} doesn't match with:${nonce.toString()}`);
  }

  const lastNonceRow = await SigServer.signedDb.getMaxNonceByRefTxHashes(pubKey, refTxHashes);
  const lastNonce = lastNonceRow.nonce;
  if (lastNonce === null) {
    return SigErrorOk;
  }
  if (lastNonce === payload.nonce) {
    // sig to tx with the same nonce, only one will be success
    await SigServer.signedDb.removeSignedRecordByNonce(payload.nonce);
    return SigErrorOk;
  }

  return new SigError(SigErrorCode.DuplicateSign);
}

async function verifyEthTx(pubKey: string, params: collectSignaturesParams): Promise<SigError> {
  if (!('domainSeparator' in params.payload)) {
    return new SigError(SigErrorCode.InvalidParams, 'the type of payload params is wrong');
  }
  const payload = params.payload as ethCollectSignaturesPayload;

  // Verify msg hash
  const rawData = buildSigRawData(
    payload.domainSeparator,
    payload.typeHash,
    payload.unlockRecords,
    BigNumber.from(payload.nonce),
  );
  if (rawData !== params.rawData) {
    return new SigError(SigErrorCode.InvalidParams, `rawData:${params.rawData} doesn't match with:${rawData}`);
  }

  // Verify unlock records all includes correct transactions
  const err = await verifyUnlockRecord(payload.unlockRecords);
  if (err.Code !== SigErrorCode.Ok) {
    return err;
  }

  // Verify was duplicate signature to unlock txs
  return await verifyDuplicateEthTx(pubKey, payload);
}

export async function signEthTx(params: collectSignaturesParams): Promise<SigResponse> {
  logger.info(`signEthTx params:, ${JSON.stringify(params)}`);
  if (!verifyCollector(params)) {
    return SigResponse.fromSigError(SigErrorCode.InvalidCollector);
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const privKey = SigServer.getKey('eth', params.requestAddress!);
  if (privKey === undefined) {
    return SigResponse.fromSigError(SigErrorCode.InvalidParams, `cannot found key by address:${params.requestAddress}`);
  }

  const ethHandler = ForceBridgeCore.getXChainHandler().eth!;
  if ((await ethHandler.getTipBlock()).height - ethHandler.getHandledBlock().height >= 10) {
    return SigResponse.fromSigError(SigErrorCode.BlockSyncUncompleted);
  }

  const signed = await SigServer.signedDb.getSignedByRawData(params.rawData);
  if (signed) {
    return SigResponse.fromData(signed.signature);
  }

  const pubKey = privateKeyToPublicKey(privKey);
  const payload = params.payload as ethCollectSignaturesPayload;

  const err = await verifyEthTx(pubKey, params);
  if (err.Code !== SigErrorCode.Ok) {
    return new SigResponse(err);
  }

  // Sign the msg hash
  const { v, r, s } = ecsign(Buffer.from(params.rawData.slice(2), 'hex'), Buffer.from(privKey.slice(2), 'hex'));
  const sigHex = toRpcSig(v, r, s);
  const signature = sigHex.slice(2);

  // Save to data base
  await SigServer.signedDb.createSigned(
    payload.unlockRecords.map((record) => {
      return {
        sigType: 'unlock',
        chain: ChainType.ETH,
        amount: BigNumber.from(record.amount).toString(),
        receiver: record.recipient,
        asset: record.token,
        refTxHash: record.ckbTxHash,
        nonce: payload.nonce,
        rawData: params.rawData,
        pubKey: pubKey,
        signature: signature,
      };
    }),
  );

  await SigServer.setPendingTx('eth', params);
  return SigResponse.fromData(signature);
}

async function verifyUnlockRecord(unlockRecords: EthUnlockRecord[]): Promise<SigError> {
  const ckbBurnTxHashes = unlockRecords.map((record) => {
    return record.ckbTxHash;
  });
  const ckbBurnRecords = await SigServer.ckbDb.getCkbBurnByTxHashes(ckbBurnTxHashes);
  const ckbBurnMap = new Map<string, ICkbBurn>();

  ckbBurnRecords.forEach((ckbBurn) => {
    ckbBurnMap.set(ckbBurn.ckbTxHash, ckbBurn);
  });

  for (const record of unlockRecords) {
    const ckbBurn = ckbBurnMap.get(record.ckbTxHash);
    if (!ckbBurn) {
      return new SigError(SigErrorCode.TxNotFound, `cannot found ckbBurn record by ckbTxHash:${record.ckbTxHash}`);
    }
    if (ckbBurn.confirmStatus !== 'confirmed') {
      return new SigError(SigErrorCode.TxUnconfirmed, `burnTx:${record.ckbTxHash} haven't confirmed`);
    }
    if (ckbBurn.asset !== record.token) {
      return new SigError(
        SigErrorCode.InvalidRecord,
        `burnTx:${record.ckbTxHash} assetAddress:${record.token} != ${ckbBurn.asset}`,
      );
    }
    if (BigInt(record.amount) > BigInt(ckbBurn.amount)) {
      return new SigError(
        SigErrorCode.InvalidRecord,
        `invalid unlock amount: ${record.amount}, greater than burn amount ${ckbBurn.amount}`,
      );
    }
    if (ckbBurn.recipientAddress !== record.recipient) {
      return new SigError(
        SigErrorCode.InvalidRecord,
        `burnTx:${record.ckbTxHash} recipientAddress:${record.recipient} != ${ckbBurn.recipientAddress}`,
      );
    }
  }
  return SigErrorOk;
}

function privateKeyToPublicKey(privateKey) {
  if (!Buffer.isBuffer(privateKey)) {
    if (typeof privateKey !== 'string') {
      throw new Error('Expected Buffer or string as argument');
    }

    privateKey = privateKey.slice(0, 2) === '0x' ? privateKey.slice(2) : privateKey;
    privateKey = Buffer.from(privateKey, 'hex');
  }
  return Buffer.from(publicKeyCreate(privateKey, false)).toString('hex');
}
