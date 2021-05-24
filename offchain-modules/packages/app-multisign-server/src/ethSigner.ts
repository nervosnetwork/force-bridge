import { ChainType } from '@force-bridge/x/dist/ckb/model/asset';
import { RecipientCellData } from '@force-bridge/x/dist/ckb/tx-helper/generated/eth_recipient_cell';
import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { isBurnTx } from '@force-bridge/x/dist/handlers/ckb';
import { collectSignaturesParams, ethCollectSignaturesPayload } from '@force-bridge/x/dist/multisig/multisig-mgr';
import { fromHexString, toHexString, uint8ArrayToString } from '@force-bridge/x/dist/utils';
import { logger } from '@force-bridge/x/dist/utils/logger';
import { EthUnlockRecord } from '@force-bridge/x/dist/xchain/eth';
import { buildSigRawData } from '@force-bridge/x/dist/xchain/eth/utils';
import { Amount } from '@lay2/pw-core';
import { ecsign, toRpcSig } from 'ethereumjs-util';
import { BigNumber } from 'ethers';
import minimist from 'minimist';
import { publicKeyCreate } from 'secp256k1';
import { SigServer } from './sigServer';

async function verifyDuplicateEthTx(
  pubKey: string,
  payload: ethCollectSignaturesPayload,
  lastFailedTxHash?: string,
): Promise<Error> {
  const refTxHashes = payload.unlockRecords.map((record) => {
    return record.ckbTxHash;
  });
  const lastNonce = await SigServer.signedDb.getMaxNonceByRefTxHashes(pubKey, refTxHashes);
  if (!lastNonce) {
    return null;
  }
  if (lastNonce === payload.nonce) {
    // sig to tx with the same nonce, only one will be success
    return null;
  }

  if (!lastFailedTxHash) {
    return new Error(`miss lastFailedTxHash with duplicate refTxHash`);
  }
  const failedTxWithReceipt = await SigServer.ethProvider.getTransactionReceipt(lastFailedTxHash);
  if (!failedTxWithReceipt) {
    return new Error(`cannot found tx receipt by lastFailedTxHash:${lastFailedTxHash}`);
  }
  if (failedTxWithReceipt.status === 1) {
    return new Error(`lastTxHash:${lastFailedTxHash} executed successful`);
  }

  // Parse abi function params to compare unlock records
  const failedTx = await SigServer.ethProvider.getTransaction(lastFailedTxHash);
  const contractUnlockParams = SigServer.ethInterface.decodeFunctionData('unlock', failedTx.data);
  const unlockResults: EthUnlockRecord[] = contractUnlockParams[0];
  const nonce: BigNumber = contractUnlockParams[1];
  if (nonce.toNumber() !== lastNonce) {
    return new Error(`nonce:${nonce} of last failed tx doesn't match with:${lastNonce}`);
  }

  if (!equalsUnlockRecord(unlockResults, payload.unlockRecords)) {
    return new Error(`payload doesn't match with lastFailedTx:${lastFailedTxHash}`);
  }
}

async function verifyEthTx(pubKey: string, params: collectSignaturesParams): Promise<Error> {
  if (!('domainSeparator' in params.payload)) {
    return Promise.reject(`the type of payload params is wrong`);
  }
  const payload = params.payload as ethCollectSignaturesPayload;

  // Verify msg hash
  const rawData = buildSigRawData(payload.domainSeparator, payload.typeHash, payload.unlockRecords, payload.nonce);
  if (rawData !== params.rawData) {
    return new Error(`rawData:${params.rawData} doesn't match with:${rawData}`);
  }

  // Verify unlock records all includes correct transactions
  let err = await verifyUnlockRecord(payload.unlockRecords);
  if (err) {
    return err;
  }

  // Verify was duplicate signature to unlock txs
  err = await verifyDuplicateEthTx(pubKey, payload, params.lastFailedTxHash);
  if (err) {
    return err;
  }
}

export async function signEthTx(params: collectSignaturesParams): Promise<string> {
  logger.info('signEthTx params: ', JSON.stringify(params, undefined, 2));

  const args = minimist(process.argv.slice(2));
  const index = args.index;
  const privKey = ForceBridgeCore.config.eth.multiSignKeys[index];
  const pubKey = privateKeyToPublicKey(privKey);
  const payload = params.payload as ethCollectSignaturesPayload;

  const err = verifyEthTx(pubKey, params);
  if (err) {
    return Promise.reject(err);
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
        amount: record.amount.toString(),
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
  return signature;
}

async function verifyUnlockRecord(unlockRecords: EthUnlockRecord[]): Promise<Error> {
  for (const record of unlockRecords) {
    const burnTx = await ForceBridgeCore.ckb.rpc.getTransaction(record.ckbTxHash);
    if (burnTx.txStatus.status !== 'committed') {
      return new Error(`burnTx:${record.ckbTxHash} status:${burnTx.txStatus.status} != committed`);
    }

    const recipientData = burnTx.transaction.outputsData[0];
    const cellData = new RecipientCellData(fromHexString(recipientData).buffer);
    const assetAddress = uint8ArrayToString(new Uint8Array(cellData.getAsset().raw()));
    const amount = Amount.fromUInt128LE(`0x${toHexString(new Uint8Array(cellData.getAmount().raw()))}`).toString(0);
    const recipientAddress = uint8ArrayToString(new Uint8Array(cellData.getRecipientAddress().raw()));

    if (assetAddress !== record.token) {
      return new Error(`burnTx assetAddress:${assetAddress} != ${record.token}`);
    }
    if (!BigNumber.from(amount).eq(record.amount)) {
      return new Error(`burnTx amount:${amount.toString()} != ${record.amount.toString()}`);
    }
    if (recipientAddress !== record.recipient) {
      return new Error(`burnTx recipientAddress:${recipientAddress} != ${record.recipient}`);
    }

    if (!(await isBurnTx(burnTx.transaction, cellData))) {
      return new Error(`burnTx:${record.ckbTxHash} is invalidate burnTx`);
    }
  }
  return null;
}

function equalsUnlockRecord(a, b: EthUnlockRecord[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].ckbTxHash !== b[i].ckbTxHash ||
      a[i].token !== b[i].token ||
      a[i].amount.toString() !== b[i].amount.toString() ||
      a[i].recipient !== b[i].recipient
    ) {
      return false;
    }
  }
  return true;
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
