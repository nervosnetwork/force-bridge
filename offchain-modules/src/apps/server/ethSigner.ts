import { BigNumber, ethers } from 'ethers';
import { ForceBridgeCore } from '@force-bridge/core';
import { logger } from '@force-bridge/utils/logger';
import { isBurnTx } from '@force-bridge/handlers/ckb';
import { RecipientCellData } from '@force-bridge/ckb/tx-helper/generated/eth_recipient_cell';
import { fromHexString, toHexString, uint8ArrayToString } from '@force-bridge/utils';
import { collectSignaturesParams, ethCollectSignaturesPayload } from '@force-bridge/multisig/multisig-mgr';
import { buildSigRawData } from '@force-bridge/xchain/eth/utils';
import { EthUnlockRecord } from '@force-bridge/xchain/eth';
import { Amount } from '@lay2/pw-core';
import { ChainType, EthAsset } from '@force-bridge/ckb/model/asset';
const { ecsign, toRpcSig } = require('ethereumjs-util');

import { abi } from '@force-bridge/xchain/eth/abi/ForceBridge.json';
import { SigServer } from './sigServer';

const UnlockABIFuncName = 'unlock';

async function checkDuplicateEthTx(pubKey: string, payload: ethCollectSignaturesPayload) {
  const signedDbRecords = await SigServer.signedDb.getSignedByPubkeyAndMsgHash(
    pubKey,
    payload.unlockRecords.map((record) => {
      return record.ckbTxHash;
    }),
  );

  if (signedDbRecords.length === 0) {
    return;
  }
  //
  // const burnTxs = signedDbRecords.map((r)=>{
  //   return r.refTxHash
  // })
  //
  // logger.info(`checkDuplicateEthTx burnTxs:${burnTxs.join(', ')}. more record info : ${JSON.stringify(payload)}. the sql query info ${JSON.stringify(
  //     signedDbRecords,
  //     null,
  //     2,
  // )}`)
  //
  //   if (!payload.failedTxHash) {
  //     return Promise.reject(
  //       `the request params has data that already exists. it must be provide failedTxHash to verify`,
  //     );
  //   }
  //
  //   const failedTxWithReceipt = await SigServer.ethProvider.getTransactionReceipt(payload.failedTxHash);
  //   if (!failedTxWithReceipt || failedTxWithReceipt.status === 1) {
  //     return Promise.reject(
  //       `the tx ${payload.failedTxHash}  exec success or is null tx. the tx receipt is ${JSON.stringify(
  //         failedTxWithReceipt,
  //         null,
  //         2,
  //       )}`,
  //     );
  //   }
  //   // Parse abi function params to compare unlock records and nonce
  //   const failedTx = await SigServer.ethProvider.getTransaction(payload.failedTxHash);
  //   const iface = new ethers.utils.Interface(abi);
  //   const contractUnlockParams = iface.decodeFunctionData(UnlockABIFuncName, failedTx.data);
  //   const unlockResults: EthUnlockRecord[] = contractUnlockParams[0];
  //   const nonce: BigNumber = contractUnlockParams[1];
  //   // const signature : string = contractUnlockParams[2];
  //   if (
  //     nonce.toString() !== payload.nonce.toString() ||
  //     !equalsUnlockRecord(unlockResults, payload.unlockRecords)
  //   ) {
  //     return Promise.reject(
  //       `the params which provided do not match the data from chain. provide record: ${JSON.stringify(
  //         payload.unlockRecords,
  //         null,
  //         2,
  //       )}, chain record: ${JSON.stringify(
  //         unlockResults,
  //         null,
  //         2,
  //       )}. provide nonce : ${payload.nonce.toString()}, chain nonce : ${nonce.toString()}`,
  //     );
  //   }
}

export async function signEthTx(params: collectSignaturesParams): Promise<string> {
  logger.info('signEthTx params: ', JSON.stringify(params, undefined, 2));

  const args = require('minimist')(process.argv.slice(2));
  const index = args.index;
  const privKey = ForceBridgeCore.config.eth.multiSignKeys[index];

  if (!('domainSeparator' in params.payload)) {
    return Promise.reject(`the type of payload params is wrong`);
  }

  const payload = params.payload as ethCollectSignaturesPayload;

  // Verify msg hash
  const msgHash = buildSigRawData(payload.domainSeparator, payload.typeHash, payload.unlockRecords, payload.nonce);
  if (params.rawData !== msgHash) {
    return Promise.reject(`the rawData ${params.rawData} does not match the calculated value`);
  }

  // Verify unlock records all includes correct transactions
  const err = await verifyUnlockRecord(payload.unlockRecords);
  if (err) {
    return Promise.reject(
      `the unlock records ${JSON.stringify(payload.unlockRecords, null, 2)} failed to burn tx verify.`,
    );
  }
  // Sign the msg hash
  const { v, r, s } = ecsign(Buffer.from(params.rawData.slice(2), 'hex'), Buffer.from(privKey.slice(2), 'hex'));
  const sigHex = toRpcSig(v, r, s);

  // // Save to data base
  // await SigServer.signedDb.createSigned(
  //   payload.payload.unlockRecords.map((record) => {
  //     return {
  //       sigType: 'unlock',
  //       chain: ChainType.ETH,
  //       amount: record.amount.toString(),
  //       asset: record.token,
  //       refTxHash: record.ckbTxHash,
  //       txHash: payload.rawData,
  //       pubkey: pubkey,
  //     };
  //   }),
  // );
  return sigHex.slice(2);
}

async function verifyUnlockRecord(unlockRecords: EthUnlockRecord[]): Promise<Error> {
  for (let record of unlockRecords) {
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
