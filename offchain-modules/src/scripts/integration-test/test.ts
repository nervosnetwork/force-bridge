import 'module-alias/register';
import nconf from 'nconf';
import { Config, TronConfig } from '@force-bridge/config';
import { logger } from '@force-bridge/utils/logger';
import { asyncSleep, bigintToSudtAmount } from '@force-bridge/utils';
import { createConnection } from 'typeorm';
import { CkbDb, TronDb } from '@force-bridge/db';
import { CkbMint, TronLock, TronUnlock } from '@force-bridge/db/model';
import assert from 'assert';
import { ChainType, EthAsset, TronAsset } from '@force-bridge/ckb/model/asset';
import { Account } from '@force-bridge/ckb/model/accounts';
import { CkbTxGenerator } from '@force-bridge/ckb/tx-helper/generator';
import { IndexerCollector } from '@force-bridge/ckb/tx-helper/collector';
import { Amount, Script } from '@lay2/pw-core';
import { CkbIndexer } from '@force-bridge/ckb/tx-helper/indexer';
import { ForceBridgeCore } from '@force-bridge/core';
import { BigNumber } from 'ethers';
const TronWeb = require('tronweb');

const PRI_KEY = '0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe';
const CKB = require('@nervosnetwork/ckb-sdk-core').default;
const CKB_URL = process.env.CKB_URL || 'http://127.0.0.1:8114';
const indexer = new CkbIndexer('http://127.0.0.1:8114', 'http://127.0.0.1:8116');
const collector = new IndexerCollector(indexer);
const ckb = new CKB(CKB_URL);

async function transferTrx(tronWeb, from, to, amount, memo, priv) {
  const from_hex = tronWeb.address.toHex(from);
  const to_hex = tronWeb.address.toHex(to);

  const unsigned_tx = await tronWeb.transactionBuilder.sendTrx(to_hex, amount, from_hex);
  const unsignedWithMemoTx = await tronWeb.transactionBuilder.addUpdateData(unsigned_tx, memo, 'utf8');

  const signed_tx = await tronWeb.trx.sign(unsignedWithMemoTx, priv);
  const broad_tx = await tronWeb.trx.broadcast(signed_tx);

  return broad_tx;
}

async function transferTrc10(tronWeb, from, to, amount, tokenID, memo, priv) {
  const unsigned_tx = await tronWeb.transactionBuilder.sendToken(to, amount, tokenID, from);
  const unsignedWithMemoTx = await tronWeb.transactionBuilder.addUpdateData(unsigned_tx, memo, 'utf8');
  const signed_tx = await tronWeb.trx.sign(unsignedWithMemoTx, priv);
  const broad_tx = await tronWeb.trx.broadcast(signed_tx);
  return broad_tx;
}

async function transferTrc20(tronWeb, from, to, amount, contractAddress, memo, priv) {
  const options = {};
  const functionSelector = 'transfer(address,uint256)';
  const params = [
    { type: 'address', value: to },
    { type: 'uint256', value: amount },
  ];

  const unsigned_tx = await tronWeb.transactionBuilder.triggerSmartContract(
    contractAddress,
    functionSelector,
    options,
    params,
    from,
  );
  const unsignedWithMemoTx = await tronWeb.transactionBuilder.addUpdateData(unsigned_tx.transaction, memo, 'utf8');

  const signed_tx = await tronWeb.trx.sign(unsignedWithMemoTx, priv);
  const broad_tx = await tronWeb.trx.broadcast(signed_tx);
  return broad_tx;
}

async function main() {
  // try 100 times and wait for 3 seconds every time.
  const checkEffect = async (sendBurn) => {
    logger.debug('test', sendBurn);
  };
  let trc10SendBurn = false;
  for (let i = 0; i < 100; i++) {
    await asyncSleep(10000);
    try {
      // await checkEffect(trxTxHash, 'trx', 'trx', trxSendBurn);
      // await burn(trxSendBurn, 'trx');
      // trxSendBurn = true;

      await checkEffect(trc10SendBurn);
      trc10SendBurn = true;

      //await checkEffect(trc20TxHash, 'TVWvkCasxAJUyzPKMQ2Rus1NtmBwrkVyBR', 'trc20');
    } catch (e) {
      logger.warn('The tron component integration not pass yet.', { i, e });
      continue;
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
