// import assert from 'assert';
// import { Account } from '@force-bridge/x/dist/ckb/model/accounts';
// import { ChainType, TronAsset } from '@force-bridge/x/dist/ckb/model/asset';
// import { IndexerCollector } from '@force-bridge/x/dist/ckb/tx-helper/collector';
// import { CkbTxGenerator } from '@force-bridge/x/dist/ckb/tx-helper/generator';
// import { CkbIndexer } from '@force-bridge/x/dist/ckb/tx-helper/indexer';
// import { getMultisigLock } from '@force-bridge/x/dist/ckb/tx-helper/multisig/multisig_helper';
// import { Config, TronConfig } from '@force-bridge/x/dist/config';
// import { bootstrap, ForceBridgeCore } from '@force-bridge/x/dist/core';
// import { CkbMint, TronLock, TronUnlock } from '@force-bridge/x/dist/db/model';
// import { asyncSleep, getDBConnection } from '@force-bridge/x/dist/utils';
// import { initLog, logger } from '@force-bridge/x/dist/utils/logger';
// import { Amount, Script } from '@lay2/pw-core';
// import CKB from '@nervosnetwork/ckb-sdk-core';
// import nconf from 'nconf';
// import TronWeb from 'tronweb';
// import { createConnection } from 'typeorm';
// import { waitUntilCommitted } from './util';

// const PRI_KEY = '0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe';
// const CKB_URL = process.env.CKB_URL || 'http://127.0.0.1:8114';
// const CKB_INDEXER_URL = process.env.CKB_INDEXER_URL || 'http://127.0.0.1:8116';
// const indexer = new CkbIndexer(CKB_URL, CKB_INDEXER_URL);
// const collector = new IndexerCollector(indexer);
// const ckb = new CKB(CKB_URL);

// async function transferTrx(tronWeb, from, to, amount, memo, priv) {
//   const from_hex = tronWeb.address.toHex(from);
//   const to_hex = tronWeb.address.toHex(to);

//   const unsigned_tx = await tronWeb.transactionBuilder.sendTrx(to_hex, amount, from_hex);
//   const unsignedWithMemoTx = await tronWeb.transactionBuilder.addUpdateData(unsigned_tx, memo, 'utf8');

//   const signed_tx = await tronWeb.trx.sign(unsignedWithMemoTx, priv);
//   const broad_tx = await tronWeb.trx.broadcast(signed_tx);

//   return broad_tx;
// }

// async function transferTrc10(tronWeb, from, to, amount, tokenID, memo, priv) {
//   const unsigned_tx = await tronWeb.transactionBuilder.sendToken(to, amount, tokenID, from);
//   const unsignedWithMemoTx = await tronWeb.transactionBuilder.addUpdateData(unsigned_tx, memo, 'utf8');
//   const signed_tx = await tronWeb.trx.sign(unsignedWithMemoTx, priv);
//   const broad_tx = await tronWeb.trx.broadcast(signed_tx);
//   return broad_tx;
// }

// async function transferTrc20(tronWeb, from, to, amount, contractAddress, memo, priv) {
//   const options = {};
//   const functionSelector = 'transfer(address,uint256)';
//   const params = [
//     { type: 'address', value: to },
//     { type: 'uint256', value: amount },
//   ];

//   const unsigned_tx = await tronWeb.transactionBuilder.triggerSmartContract(
//     contractAddress,
//     functionSelector,
//     options,
//     params,
//     from,
//   );
//   const unsignedWithMemoTx = await tronWeb.transactionBuilder.addUpdateData(unsigned_tx.transaction, memo, 'utf8');

//   const signed_tx = await tronWeb.trx.sign(unsignedWithMemoTx, priv);
//   const broad_tx = await tronWeb.trx.broadcast(signed_tx);
//   return broad_tx;
// }

// async function main() {
//   const conn = await getDBConnection();

//   const configPath = process.env.CONFIG_PATH || './config.json';
//   nconf.env().file({ file: configPath });
//   const config: TronConfig = nconf.get('forceBridge:tron');
//   const conf: Config = nconf.get('forceBridge');
//   conf.common.log.logFile = './log/tron-ci.log';
//   await bootstrap(conf);

//   const tronWeb = new TronWeb({
//     fullHost: config.tronGridUrl,
//   });

//   const userPrivateKey = 'AECC2FBC0BF175DDD04BD1BC3B64A13DB98738962A512544C89B50F5DDB7EBBD';
//   const from = tronWeb.address.fromPrivateKey(userPrivateKey);
//   const to = config.committee.address;
//   const amount = 10;
//   const recipientLockscript = 'ckt1qyqyph8v9mclls35p6snlaxajeca97tc062sa5gahk';
//   const sudtExtraData = 'transfer 100 to ckt1qyqyph8v9mclls35p6snlaxajeca97tc062sa5gahk';
//   const memo = recipientLockscript.concat(',').concat(sudtExtraData);

//   const trxLockRes = await transferTrx(tronWeb, from, to, amount, memo, userPrivateKey);
//   logger.info('trxLockRes:', trxLockRes);
//   const trxTxHash: string = trxLockRes.transaction.txID;

//   const trc10LockRes = await transferTrc10(tronWeb, from, to, amount, '1000696', memo, userPrivateKey);
//   logger.info('trc10LockRes:', trc10LockRes);
//   const trc10TxHash: string = trc10LockRes.transaction.txID;

//   const trc20LockRes = await transferTrc20(
//     tronWeb,
//     from,
//     to,
//     amount,
//     'TVWvkCasxAJUyzPKMQ2Rus1NtmBwrkVyBR',
//     memo,
//     userPrivateKey,
//   );
//   const trc20TxHash: string = trc20LockRes.transaction.txID;

//   // create tron unlock
//   const recipientAddress = 'TS6VejPL8cQy6pA8eDGyusmmhCrXHRdJK6';
//   let burnTxHash;

//   const getBalance = async (assetName) => {
//     const account = new Account(PRI_KEY);
//     const multisigLockScript = getMultisigLock(ForceBridgeCore.config.ckb.multisigScript);
//     const ownLockHash = ckb.utils.scriptToHash(<CKBComponents.Script>{
//       codeHash: multisigLockScript.code_hash,
//       hashType: multisigLockScript.hash_type,
//       args: multisigLockScript.args,
//     });
//     const asset = new TronAsset(assetName, ownLockHash);
//     const bridgeCellLockscript = {
//       codeHash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
//       hashType: ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
//       args: asset.toBridgeLockscriptArgs(),
//     };
//     const sudtArgs = ckb.utils.scriptToHash(<CKBComponents.Script>bridgeCellLockscript);
//     const sudtType = {
//       codeHash: ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash,
//       hashType: ForceBridgeCore.config.ckb.deps.sudtType.script.hashType,
//       args: sudtArgs,
//     };
//     const balance = await collector.getSUDTBalance(
//       new Script(sudtType.codeHash, sudtType.args, sudtType.hashType),
//       await account.getLockscript(),
//     );
//     return balance;
//   };

//   const checkLock = async (txHash, assetName, assetType, beforeLockBalance, sendBurn) => {
//     // check TronLock and CkbMint saved.
//     const tronLockRecords = await conn.manager.find(TronLock, {
//       where: {
//         txHash: txHash,
//       },
//     });
//     logger.info('tronLockRecords', tronLockRecords);
//     assert(tronLockRecords.length === 1);
//     const tronLockRecord = tronLockRecords[0];

//     assert(tronLockRecord.memo === memo);
//     assert(tronLockRecord.sender === from);
//     assert(tronLockRecord.asset === assetName);
//     assert(tronLockRecord.assetType === assetType);

//     const ckbMintRecords = await conn.manager.find(CkbMint, {
//       where: {
//         id: txHash.concat('_').concat(tronLockRecord.txIndex.toString()),
//       },
//     });
//     logger.info('ckbMintRecords', ckbMintRecords);
//     assert(ckbMintRecords.length === 1);
//     const ckbMintRecord = ckbMintRecords[0];
//     assert(ckbMintRecord.chain === ChainType.TRON);
//     assert(ckbMintRecord.sudtExtraData === sudtExtraData);
//     assert(ckbMintRecord.status === 'success');
//     assert(ckbMintRecord.asset === assetName);
//     assert(ckbMintRecord.amount === amount.toString());
//     assert(ckbMintRecord.recipientLockscript === recipientLockscript);

//     // check sudt balance.
//     const balance = await getBalance(assetName);

//     if (!sendBurn) {
//       logger.info('assetName', assetName);
//       logger.info('beforeLockBalance', beforeLockBalance);
//       logger.info('sudt balance:', balance);
//       logger.info('expect balance:', new Amount(amount.toString(), 0).add(beforeLockBalance));
//       assert(balance.eq(new Amount(amount.toString(), 0).add(beforeLockBalance)));
//     }
//   };

//   const burn = async (sendBurn, assetName, txHash) => {
//     const burnAmount = 1;
//     if (!sendBurn) {
//       const account = new Account(PRI_KEY);
//       const multisigLockScript = getMultisigLock(ForceBridgeCore.config.ckb.multisigScript);
//       const ownLockHash = ckb.utils.scriptToHash(<CKBComponents.Script>{
//         codeHash: multisigLockScript.code_hash,
//         hashType: multisigLockScript.hash_type,
//         args: multisigLockScript.args,
//       });
//       const generator = new CkbTxGenerator(ckb, indexer);
//       const burnTx = await generator.burn(
//         await account.getLockscript(),
//         recipientAddress,
//         new TronAsset(assetName, ownLockHash),
//         new Amount(burnAmount.toString(), 0),
//       );
//       const signedTx = ckb.signTransaction(PRI_KEY)(burnTx);
//       burnTxHash = await ckb.rpc.sendTransaction(signedTx);
//       console.info(`burn Transaction has been sent with tx hash ${burnTxHash}`);
//       await waitUntilCommitted(ckb, burnTxHash, 60);
//       return burnTxHash;
//     }
//     return txHash;
//   };

//   const checkUnlock = async (burnTxHash, assetName) => {
//     const burnAmount = 1;
//     const balance = await getBalance(assetName);

//     logger.info('sudt balance:', balance);
//     const expectBalance = new Amount((amount - burnAmount).toString(), 0);
//     logger.info('expect sudt balance:', expectBalance);
//     assert(balance.eq(expectBalance));

//     // check unlock record send
//     const tronUnlockRecords = await conn.manager.find(TronUnlock, {
//       where: {
//         ckbTxHash: burnTxHash,
//       },
//     });
//     assert(tronUnlockRecords.length === 1);
//     const tronUnlockRecord = tronUnlockRecords[0];
//     assert(tronUnlockRecord.status === 'success');
//   };

//   // try 100 times and wait for 3 seconds every time.
//   let trxSendBurn = false;
//   let trc10SendBurn = false;
//   let burnTrxTxHash = '';
//   let burnTrc10TxHash = '';

//   for (let i = 0; i < 100; i++) {
//     await asyncSleep(10000);
//     try {
//       const beforeLockTrxBalance = await getBalance('trx');
//       await checkLock(trxTxHash, 'trx', 'trx', beforeLockTrxBalance, trxSendBurn);
//       burnTrxTxHash = await burn(trxSendBurn, 'trx', burnTrxTxHash);
//       trxSendBurn = true;
//       await checkUnlock(burnTrxTxHash, 'trx');

//       const beforeLockTrc10Balance = await getBalance('1000696');
//       await checkLock(trc10TxHash, '1000696', 'trc10', beforeLockTrc10Balance, trc10SendBurn);
//       burnTrc10TxHash = await burn(trc10SendBurn, '1000696', burnTrc10TxHash);
//       trc10SendBurn = true;
//       await checkUnlock(burnTrc10TxHash, '1000696');

//       //await checkEffect(trc20TxHash, 'TVWvkCasxAJUyzPKMQ2Rus1NtmBwrkVyBR', 'trc20');
//     } catch (e) {
//       logger.warn(`The tron component integration not pass yet. i:${i} error:`, e);
//       continue;
//     }
//     logger.info('The tron component integration test pass!');
//     return;
//   }
//   throw new Error('The tron component integration test failed!');
// }

// main()
//   .then(() => process.exit(0))
//   .catch((error) => {
//     console.error(error);
//     process.exit(1);
//   });
