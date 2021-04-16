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
import { waitUntilCommitted } from './util';
import { multisigLockScript } from '@force-bridge/ckb/tx-helper/multisig/multisig_helper';
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

async function main() {
  const conn = await createConnection();

  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const config: TronConfig = nconf.get('forceBridge:tron');
  logger.debug('config', config);
  const conf: Config = nconf.get('forceBridge');
  // init bridge force core
  await new ForceBridgeCore().init(conf);

  const tronWeb = new TronWeb({
    fullHost: config.tronGridUrl,
  });

  const userPrivateKey = 'AECC2FBC0BF175DDD04BD1BC3B64A13DB98738962A512544C89B50F5DDB7EBBD';
  const from = tronWeb.address.fromPrivateKey(userPrivateKey);
  const to = config.committee.address;
  const amount = 10;
  const recipientLockscript = 'ckt1qyqyph8v9mclls35p6snlaxajeca97tc062sa5gahk';
  const sudtExtraData = 'transfer 100 to ckt1qyqyph8v9mclls35p6snlaxajeca97tc062sa5gahk';
  const memo = recipientLockscript.concat(',').concat(sudtExtraData);
  const lockRes = await transferTrx(tronWeb, from, to, amount, memo, userPrivateKey);
  const txHash: string = lockRes.transaction.txID;

  // create tron unlock
  const recipientAddress = 'TS6VejPL8cQy6pA8eDGyusmmhCrXHRdJK6';
  let sendBurn = false;
  let burnTxHash;
  const checkEffect = async () => {
    // check TronLock and CkbMint saved.
    const tronLockRecords = await conn.manager.find(TronLock, {
      where: {
        txHash: txHash,
      },
    });
    logger.debug('tronLockRecords', tronLockRecords);
    assert(tronLockRecords.length === 1);
    const tronLockRecord = tronLockRecords[0];

    assert(tronLockRecord.memo === memo);
    assert(tronLockRecord.sender === from);
    assert(tronLockRecord.asset === 'trx');
    assert(tronLockRecord.assetType === 'trx');

    const ckbMintRecords = await conn.manager.find(CkbMint, {
      where: {
        id: txHash.concat('_').concat(tronLockRecord.txIndex.toString()),
      },
    });
    logger.debug('ckbMintRecords', ckbMintRecords);
    assert(ckbMintRecords.length === 1);
    const ckbMintRecord = ckbMintRecords[0];
    assert(ckbMintRecord.chain === ChainType.TRON);
    assert(ckbMintRecord.sudtExtraData === sudtExtraData);
    assert(ckbMintRecord.status === 'success');
    // assert(ckbMintRecord.asset === 'trx');
    assert(ckbMintRecord.amount === amount.toString());
    assert(ckbMintRecord.recipientLockscript === recipientLockscript);

    // check sudt balance.
    const account = new Account(PRI_KEY);
    const ownLockHash = ckb.utils.scriptToHash(<CKBComponents.Script>{
      codeHash: multisigLockScript.code_hash,
      hashType: multisigLockScript.hash_type,
      args: multisigLockScript.args,
    });
    const asset = new TronAsset('trx', ownLockHash);
    const bridgeCellLockscript = {
      codeHash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
      hashType: ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
      args: asset.toBridgeLockscriptArgs(),
    };
    const sudtArgs = ckb.utils.scriptToHash(<CKBComponents.Script>bridgeCellLockscript);
    const sudtType = {
      codeHash: ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash,
      hashType: ForceBridgeCore.config.ckb.deps.sudtType.script.hashType,
      args: sudtArgs,
    };
    const balance = await collector.getSUDTBalance(
      new Script(sudtType.codeHash, sudtType.args, sudtType.hashType),
      await account.getLockscript(),
    );

    if (!sendBurn) {
      logger.debug('sudt balance:', balance);
      logger.debug('expect balance:', new Amount(amount.toString()));
      assert(balance.eq(new Amount(amount.toString())));
    }

    const burnAmount = 1;
    // send burn tx
    if (!sendBurn) {
      const account = new Account(PRI_KEY);
      const ownLockHash = ckb.utils.scriptToHash(<CKBComponents.Script>await account.getLockscript());
      const generator = new CkbTxGenerator(ckb, new IndexerCollector(indexer));
      const burnTx = await generator.burn(
        await account.getLockscript(),
        recipientAddress,
        new TronAsset('trx', ownLockHash),
        new Amount(burnAmount.toString()),
      );
      const signedTx = ckb.signTransaction(PRI_KEY)(burnTx);
      burnTxHash = await ckb.rpc.sendTransaction(signedTx);
      console.log(`burn Transaction has been sent with tx hash ${burnTxHash}`);
      await waitUntilCommitted(ckb, burnTxHash, 60);
      sendBurn = true;
    }

    logger.debug('sudt balance:', balance);
    const expectBalance = new Amount((amount - burnAmount).toString());
    logger.debug('expect sudt balance:', expectBalance);
    assert(balance.eq(expectBalance));

    // check unlock record send
    const tronUnlockRecords = await conn.manager.find(TronUnlock, {
      where: {
        ckbTxHash: burnTxHash,
      },
    });
    assert(tronUnlockRecords.length === 1);
    const tronUnlockRecord = tronUnlockRecords[0];
    assert(tronUnlockRecord.status === 'success');
  };

  // try 100 times and wait for 3 seconds every time.
  for (let i = 0; i < 100; i++) {
    await asyncSleep(10000);
    try {
      await checkEffect();
    } catch (e) {
      logger.warn('The tron component integration not pass yet.', { i, e });
      continue;
    }
    logger.info('The tron component integration test pass!');
    return;
  }
  throw new Error('The tron component integration test failed!');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
