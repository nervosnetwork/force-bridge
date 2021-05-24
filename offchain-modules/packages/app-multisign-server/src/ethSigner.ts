import { ChainType } from '@force-bridge/x/dist/ckb/model/asset';
import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { ICkbBurn } from '@force-bridge/x/dist/db/model';
import { collectSignaturesParams, ethCollectSignaturesPayload } from '@force-bridge/x/dist/multisig/multisig-mgr';
import { logger } from '@force-bridge/x/dist/utils/logger';
import { EthUnlockRecord } from '@force-bridge/x/dist/xchain/eth';
import { buildSigRawData } from '@force-bridge/x/dist/xchain/eth/utils';
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
      return new Error(`cannot found ckbBurn record by ckbTxHash:${record.ckbTxHash}`);
    }
    if (ckbBurn.confirmStatus !== 'confirmed') {
      return new Error(`burnTx:${record.ckbTxHash} haven't confirmed`);
    }
    if (ckbBurn.asset !== record.token) {
      return new Error(`burnTx:${record.ckbTxHash} assetAddress:${record.token} != ${ckbBurn.asset}`);
    }
    if (ckbBurn.amount !== record.amount) {
      return new Error(`burnTx:${record.ckbTxHash} amount:${record.amount} != ${ckbBurn.amount}`);
    }
    if (ckbBurn.recipientAddress !== record.recipient) {
      return new Error(
        `burnTx:${record.ckbTxHash} recipientAddress:${record.recipient} != ${ckbBurn.recipientAddress}`,
      );
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
