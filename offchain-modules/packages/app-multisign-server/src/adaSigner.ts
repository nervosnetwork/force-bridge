import { ChainType } from '@force-bridge/x/dist/ckb/model/asset';
import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { ICkbBurn } from '@force-bridge/x/dist/db/model';
import { collectSignaturesParams, adaCollectSignaturesPayload } from '@force-bridge/x/dist/multisig/multisig-mgr';
import { verifyCollector } from '@force-bridge/x/dist/multisig/utils';
import { logger } from '@force-bridge/x/dist/utils/logger';
import { publicKeyCreate } from 'secp256k1';
import { SigError, SigErrorCode, SigErrorOk } from './error';
import { SigResponse, SigServer } from './sigServer';
import * as utils from '@force-bridge/x/dist/xchain/ada/utils';
import * as CardanoWasm from '@emurgo/cardano-serialization-lib-nodejs';


export async function signAdaTx(params: collectSignaturesParams): Promise<SigResponse> {
  logger.debug(`signAdaTx params:, ${JSON.stringify(params)}`);
  // if (!verifyCollector(params)) {
  //   return SigResponse.fromSigError(SigErrorCode.InvalidCollector);
  // }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const privKeyBytes = SigServer.getKey('ada', '');
  if (privKeyBytes === undefined) {
    return SigResponse.fromSigError(SigErrorCode.InvalidParams, `cannot found key by address:${params.requestAddress}`);
  }

  const privKey = CardanoWasm.PrivateKey.from_extended_bytes(Buffer.from(privKeyBytes, 'hex'));

  // const adaHandler = ForceBridgeCore.getXChainHandler().ada!;
  // if ((await adaHandler.getTipBlock()).height - adaHandler.gadaandledBlock().height >= 10) {
  //   return SigResponse.fromSigError(SigErrorCode.BlockSyncUncompleted);
  // }

  const signed = await SigServer.signedDb.getSignedByRawData(params.rawData);
  if (signed) {
    return SigResponse.fromData(signed.signature);
  }

  const pubKeyHash = privKey.to_public().hash().to_bech32("addr_vkh");
  const payload = params.payload as adaCollectSignaturesPayload;

  let txBody: CardanoWasm.TransactionBody | undefined = undefined;
  try {
    let txBodyBytes = Buffer.from(params.rawData, 'hex');
    txBody = CardanoWasm.TransactionBody.from_bytes(txBodyBytes);
  } catch (e) {
    return SigResponse.fromSigError(SigErrorCode.InvalidParams, `cannot deserialize txBody`);
  }
  // const err = await verifyAdaTx(pubKey, params);
  // if (err.Code !== SigErrorCode.Ok) {
  //   return new SigResponse(err);
  // }

  // Sign the msg hash
  const txHash = CardanoWasm.hash_transaction(txBody);

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
        rawData: txHash.to_bech32("txhash"), // rawdata is too long
        pubKey: pubKeyHash,
        signature: signature,
      };
    }),
  );

  await SigServer.setPendingTx('cardano', params);
  return SigResponse.fromData(signature);
}
