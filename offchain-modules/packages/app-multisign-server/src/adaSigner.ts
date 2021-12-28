import * as CardanoWasm from '@emurgo/cardano-serialization-lib-nodejs';
import { ChainType } from '@force-bridge/x/dist/ckb/model/asset';
import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { ICkbBurn, IAdaUnlock } from '@force-bridge/x/dist/db/model';
import { collectSignaturesParams, adaCollectSignaturesPayload } from '@force-bridge/x/dist/multisig/multisig-mgr';
import { verifyCollector } from '@force-bridge/x/dist/multisig/utils';
import { logger } from '@force-bridge/x/dist/utils/logger';
import { SigError, SigErrorCode, SigErrorOk } from './error';
import { SigResponse, SigServer } from './sigServer';

export async function signAdaTx(params: collectSignaturesParams): Promise<SigResponse> {
  logger.debug(`signAdaTx params:, ${JSON.stringify(params)}`);
  if (!verifyCollector(params)) {
    return SigResponse.fromSigError(SigErrorCode.InvalidCollector);
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const privKeyBytes = SigServer.getKey('ada', '');
  if (privKeyBytes === undefined) {
    return SigResponse.fromSigError(SigErrorCode.InvalidParams, `cannot found key by address:${params.requestAddress}`);
  }

  const privKey = CardanoWasm.PrivateKey.from_extended_bytes(Buffer.from(privKeyBytes, 'hex'));

  let txBody: CardanoWasm.TransactionBody | undefined = undefined;
  try {
    const txBodyBytes = Buffer.from(params.rawData, 'hex');
    txBody = CardanoWasm.TransactionBody.from_bytes(txBodyBytes);
  } catch (e) {
    return SigResponse.fromSigError(SigErrorCode.InvalidParams, `cannot deserialize txBody`);
  }

  const txHash = CardanoWasm.hash_transaction(txBody);

  const dbKey = txHash.to_bech32('txhash'); // rawData is too long to store in db

  const signed = await SigServer.signedDb.getSignedByRawData(dbKey);
  if (signed) {
    return SigResponse.fromData(signed.signature);
  }

  const adaHandler = ForceBridgeCore.getXChainHandler().ada!;
  const networkTip = (await adaHandler.getTipBlock()).height;
  if (networkTip - adaHandler.getHandledBlock().height >= 30) {
    // TODO: Make this configurable for integration tests
    return SigResponse.fromSigError(SigErrorCode.BlockSyncUncompleted);
  }

  const payload = params.payload as adaCollectSignaturesPayload;
  const err = await verifyTx(payload, txBody, networkTip);
  if (err.Code !== SigErrorCode.Ok) {
    return new SigResponse(err);
  }

  // Sign the msg hash

  const pubKeyHash = privKey.to_public().hash().to_bech32('addr_vkh');

  const vkeyWitness = CardanoWasm.make_vkey_witness(txHash, privKey);
  const signature = Buffer.from(vkeyWitness.to_bytes()).toString('hex');

  // Save to data base
  await SigServer.signedDb.createSigned(
    payload.unlockRecords.map((record) => {
      return {
        sigType: 'unlock',
        chain: ChainType.CARDANO,
        amount: record.amount,
        receiver: record.recipientAddress,
        asset: record.asset,
        refTxHash: record.ckbTxHash,
        nonce: 0,
        rawData: dbKey, // rawdata is too long
        pubKey: pubKeyHash,
        signature: signature,
      };
    }),
  );

  await SigServer.setPendingTx('cardano', params);
  return SigResponse.fromData(signature);
}

async function verifyTx(
  payload: adaCollectSignaturesPayload,
  txBody: CardanoWasm.TransactionBody,
  networkTip: number,
): Promise<SigError> {
  // Verify unlock records all includes correct transactions
  const err = await verifyUnlockRecord(payload.unlockRecords);
  if (err.Code !== SigErrorCode.Ok) {
    return err;
  }

  const TTL_LIMIT = 1000;
  const ttl = txBody.ttl();
  if (ttl == undefined || ttl - networkTip > TTL_LIMIT) {
    return new SigError(SigErrorCode.InvalidParams);
  }

  // Verify if this burn tx has already been signed
  // TODO: this needs to be more comprehensive check and take into consideration ttl
  return await verifyDuplicateAdaTx(payload);
}

async function verifyUnlockRecord(unlockRecords: IAdaUnlock[]): Promise<SigError> {
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
    if (BigInt(record.amount) > BigInt(ckbBurn.amount)) {
      return new SigError(
        SigErrorCode.InvalidRecord,
        `invalid unlock amount: ${record.amount}, greater than burn amount ${ckbBurn.amount}`,
      );
    }
    if (ckbBurn.recipientAddress !== record.recipientAddress) {
      return new SigError(
        SigErrorCode.InvalidRecord,
        `burnTx:${record.ckbTxHash} recipientAddress:${record.recipientAddress} != ${ckbBurn.recipientAddress}`,
      );
    }
  }
  return SigErrorOk;
}

async function verifyDuplicateAdaTx(payload: adaCollectSignaturesPayload): Promise<SigError> {
  const refTxHashes = payload.unlockRecords.map((record) => {
    return record.ckbTxHash;
  });

  const unlocks = await SigServer.adaDb.getAdaUnlockByCkbTxHashes(refTxHashes);
  if (unlocks.length !== 0) {
    return new SigError(SigErrorCode.TxCompleted);
  }
  return SigErrorOk;
}
