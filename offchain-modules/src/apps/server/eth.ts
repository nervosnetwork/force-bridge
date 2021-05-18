import { BigNumber, ethers } from 'ethers';
import { ForceBridgeCore } from '@force-bridge/core';
import { logger } from '@force-bridge/utils/logger';
import { isBurnTx } from '@force-bridge/handlers/ckb';
import { RecipientCellData } from '@force-bridge/ckb/tx-helper/generated/eth_recipient_cell';
import { fromHexString, toHexString, uint8ArrayToString } from '@force-bridge/utils';
import { collectSignaturesParams } from '@force-bridge/multisig/multisig-mgr';
import { buildSigRawData } from '@force-bridge/xchain/eth/utils';
import { EthUnlockRecord } from '@force-bridge/xchain/eth';
import { Amount } from '@lay2/pw-core';
import { SignedDb } from '@force-bridge/db/signed';
import { ChainType } from '@force-bridge/ckb/model/asset';
const { ecsign, toRpcSig } = require('ethereumjs-util');

import { abi } from '@force-bridge/xchain/eth/abi/ForceBridge.json';
import { SigServer } from './sigserver';

const UnlockABIFuncName = 'unlock';
export async function signEthTx(payload: collectSignaturesParams, signedDb: SignedDb): Promise<string> {
  logger.debug('signEthTx msg: ', payload);
  const args = require('minimist')(process.argv.slice(2));
  const index = args.index;
  const privKey = SigServer.config.eth.multiSignKeys[index];

  if (!('domainSeparator' in payload.payload)) {
    return Promise.reject(`the type of payload params is wrong`);
  }
  // Verify msg hash
  const msgHash = buildSigRawData(
    payload.payload.domainSeparator,
    payload.payload.typeHash,
    payload.payload.unlockRecords,
    payload.payload.nonce,
  );
  if (payload.rawData !== msgHash) {
    return Promise.reject(`the rawData ${payload.rawData} does not match the calculated value`);
  }

  // Verify whether the user submits duplicate data
  const provider = new ethers.providers.JsonRpcProvider(ForceBridgeCore.config.eth.rpcUrl);
  const wallet = new ethers.Wallet(privKey, SigServer.ethProvider);
  const pubkey = wallet.publicKey;
  const signedDbRecords = await signedDb.getSignedByPubkeyAndMsgHash(
    pubkey,
    payload.payload.unlockRecords.map((record) => {
      return record.ckbTxHash;
    }),
  );
  if (signedDbRecords.length > 0) {
    logger.warn(
      `the msg hash ${payload.rawData} has been saved in db. the failed tx by user provide is ${
        payload.failedTxHash
      }. more record info : ${JSON.stringify(payload.payload)}. the sql query info ${JSON.stringify(
        signedDbRecords,
        null,
        2,
      )}`,
    );
    if (!payload.failedTxHash) {
      return Promise.reject(
        `the request params has data that already exists. it must be provide failedTxHash to verify`,
      );
    }

    const failedTxWithReceipt = await provider.getTransactionReceipt(payload.failedTxHash);
    if (!failedTxWithReceipt || failedTxWithReceipt.status === 1) {
      return Promise.reject(
        `the tx ${payload.failedTxHash}  exec success or is null tx. the tx receipt is ${JSON.stringify(
          failedTxWithReceipt,
          null,
          2,
        )}`,
      );
    }
    // Parse abi function params to compare unlock records and nonce
    const failedTx = await provider.getTransaction(payload.failedTxHash);
    const iface = new ethers.utils.Interface(abi);
    const contractUnlockParams = iface.decodeFunctionData(UnlockABIFuncName, failedTx.data);
    const unlockResults: EthUnlockRecord[] = contractUnlockParams[0];
    const nonce: BigNumber = contractUnlockParams[1];
    // const signature : string = contractUnlockParams[2];
    if (
      nonce.toString() !== payload.payload.nonce.toString() ||
      !equalsUnlockRecord(unlockResults, payload.payload.unlockRecords)
    ) {
      return Promise.reject(
        `the params which provided do not match the data from chain. provide record: ${JSON.stringify(
          payload.payload.unlockRecords,
          null,
          2,
        )}, chain record: ${JSON.stringify(
          unlockResults,
          null,
          2,
        )}. provide nonce : ${payload.payload.nonce.toString()}, chain nonce : ${nonce.toString()}`,
      );
    }
  }

  // Verify unlock records all includes correct transactions
  if (!(await verifyUnlockRecord(payload.payload.unlockRecords))) {
    return Promise.reject(
      `the unlock records ${JSON.stringify(payload.payload.unlockRecords, null, 2)} failed to burn tx verify.`,
    );
  }
  // Sign the msg hash
  const { v, r, s } = ecsign(
    Buffer.from(payload.rawData.slice(2), 'hex'),
    Buffer.from(wallet.privateKey.slice(2), 'hex'),
  );
  const sigHex = toRpcSig(v, r, s);

  // Save to data base
  await signedDb.createSigned(
    payload.payload.unlockRecords.map((record) => {
      return {
        sigType: 'unlock',
        chain: ChainType.ETH,
        amount: record.amount.toString(),
        asset: record.token,
        refTxHash: record.ckbTxHash,
        txHash: payload.rawData,
        pubkey: pubkey,
      };
    }),
  );
  return sigHex.slice(2);
}

async function verifyUnlockRecord(unlockRecords: EthUnlockRecord[]): Promise<boolean> {
  try {
    for (let record of unlockRecords) {
      const burnTx = await ForceBridgeCore.ckb.rpc.getTransaction(record.ckbTxHash);
      if (burnTx.txStatus !== 'commit') {
        logger.warn(
          `ETH MultiSign Verify: the tx ${record.ckbTxHash} status is ${burnTx.txStatus} which is not confirmed`,
        );
        return false;
      }
      const recipientData = burnTx.transaction.outputsData[0];
      const cellData = new RecipientCellData(fromHexString(recipientData).buffer);
      const assetAddress = uint8ArrayToString(new Uint8Array(cellData.getAsset().raw()));
      const amount = Amount.fromUInt128LE(`0x${toHexString(new Uint8Array(cellData.getAmount().raw()))}`).toString(0);
      const recipientAddress = uint8ArrayToString(new Uint8Array(cellData.getRecipientAddress().raw()));
      if (
        assetAddress !== record.token ||
        BigNumber.from(amount) !== record.amount ||
        recipientAddress !== record.recipient
      ) {
        logger.warn(
          `ETH MultiSign Verify: the tx ${record.ckbTxHash} cell data contain : asset ${assetAddress}, amount ${amount}, recipient ${recipientAddress}`,
        );
        return false;
      }
      if (!(await isBurnTx(burnTx.transaction, cellData))) {
        logger.warn(`ETH MultiSign Verify: the tx ${record.ckbTxHash}  is not burn tx`);
        return false;
      }
    }
    return true;
  } catch (e) {
    throw new Error(`ETH MultiSign Error during verify unlock record by :` + e);
  }
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
