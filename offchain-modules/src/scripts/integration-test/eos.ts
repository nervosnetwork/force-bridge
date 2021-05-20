import { createConnection } from 'typeorm';
import 'module-alias/register';
import nconf from 'nconf';
import { Config, EosConfig } from '@force-bridge/config';
import { initLog, logger } from '@force-bridge/utils/logger';
import { JsSignatureProvider } from 'eosjs/dist/eosjs-jssig';
import { EosLock, getEosLockId } from '@force-bridge/db/entity/EosLock';
import assert from 'assert';
import { CkbMint } from '@force-bridge/db/entity/CkbMint';
import { ChainType, EosAsset } from '@force-bridge/ckb/model/asset';
import { EosUnlock } from '@force-bridge/db/entity/EosUnlock';
import { EosChain } from '@force-bridge/xchain/eos/eosChain';
import { Account } from '@force-bridge/ckb/model/accounts';
import { CkbTxGenerator } from '@force-bridge/ckb/tx-helper/generator';
import { IndexerCollector } from '@force-bridge/ckb/tx-helper/collector';
import { Amount, Script } from '@lay2/pw-core';
import { CkbIndexer } from '@force-bridge/ckb/tx-helper/indexer';
import { ForceBridgeCore } from '@force-bridge/core';
import { waitUntilCommitted, waitFnCompleted } from './util';
import { getMultisigLock } from '@force-bridge/ckb/tx-helper/multisig/multisig_helper';
// import { multisigLockScript } from '@force-bridge/ckb/tx-helper/multisig/multisig_helper';

const CKB = require('@nervosnetwork/ckb-sdk-core').default;
const CKB_URL = process.env.CKB_URL || 'http://127.0.0.1:8114';
const indexer = new CkbIndexer('http://127.0.0.1:8114', 'http://127.0.0.1:8116');
const collector = new IndexerCollector(indexer);
const ckb = new CKB(CKB_URL);

async function main() {
  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const config: EosConfig = nconf.get('forceBridge:eos');
  const conf: Config = nconf.get('forceBridge');
  conf.common.log.logFile = './log/eos-ci.log';
  initLog(conf.common.log);
  logger.debug('EosConfig:', config);

  // init bridge force core
  await new ForceBridgeCore().init(conf);

  const rpcUrl = config.rpcUrl;
  const PRI_KEY = ForceBridgeCore.config.ckb.fromPrivateKey;
  const lockAccount = 'alice';
  const lockAccountPri = ['5KQG4541B1FtDC11gu3NrErWniqTaPHBpmikSztnX8m36sK5px5'];
  const chain = new EosChain(rpcUrl, new JsSignatureProvider(lockAccountPri));
  const conn = await createConnection();
  //lock eos
  const recipientLockscript = 'ckt1qyqyph8v9mclls35p6snlaxajeca97tc062sa5gahk';
  const memo = recipientLockscript;
  const lockAmount = '0.0001';
  const lockAsset = 'EOS';
  const eosTokenAccount = 'eosio.token';

  const lockTxRes = await chain.transfer(
    lockAccount,
    config.bridgerAccount,
    'active',
    `${lockAmount} ${lockAsset}`,
    memo,
    eosTokenAccount,
    {
      broadcast: true,
      blocksBehind: 3,
      expireSeconds: 30,
    },
  );

  let lockTxHash: string;
  if ('transaction_id' in lockTxRes) {
    lockTxHash = lockTxRes.transaction_id;
    logger.debug(`EosLockTx:${lockTxRes}`);
  } else {
    throw new Error('send lock eos transaction failed. txRes:' + lockTxRes);
  }
  const transferActionId = getEosLockId(lockTxHash, 3); //index is 3 in eos local node

  //check EosLock and EosMint saved.
  const waitTimeout = 1000 * 60 * 5; //5 minutes
  await waitFnCompleted(
    waitTimeout,
    async (): Promise<boolean> => {
      const eosLockRecords = await conn.manager.find(EosLock, {
        where: {
          id: transferActionId,
        },
      });
      const ckbMintRecords = await conn.manager.find(CkbMint, {
        where: {
          id: transferActionId,
        },
      });
      if (eosLockRecords.length == 0 || ckbMintRecords.length === 0) {
        return false;
      }

      logger.info('EosLockRecords', eosLockRecords);
      logger.info('CkbMintRecords', ckbMintRecords);

      assert(eosLockRecords.length === 1);
      const eosLockRecord = eosLockRecords[0];
      assert(eosLockRecord.amount === new Amount(lockAmount, 4).toString(0));
      assert(eosLockRecord.token === lockAsset);
      assert(eosLockRecord.memo === memo);
      assert(eosLockRecord.sender === lockAccount);

      assert(ckbMintRecords.length === 1);
      const ckbMintRecord = ckbMintRecords[0];
      assert(ckbMintRecord.chain === ChainType.EOS);
      assert(ckbMintRecord.asset === lockAsset);
      assert(ckbMintRecord.amount === new Amount(lockAmount, 4).toString(0));
      assert(ckbMintRecord.recipientLockscript === recipientLockscript);
      return ckbMintRecord.status === 'success';
    },
    1000 * 10,
  );

  // check sudt balance.
  const account = new Account(PRI_KEY);
  const multisigLockScript = getMultisigLock(ForceBridgeCore.config.ckb.multisigScript);
  const ownLockHash = ckb.utils.scriptToHash(<CKBComponents.Script>{
    codeHash: multisigLockScript.code_hash,
    hashType: multisigLockScript.hash_type,
    args: multisigLockScript.args,
  });
  const asset = new EosAsset(lockAsset, ownLockHash);
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
  await waitFnCompleted(
    waitTimeout,
    async (): Promise<boolean> => {
      const balance = await collector.getSUDTBalance(
        new Script(sudtType.codeHash, sudtType.args, sudtType.hashType),
        await account.getLockscript(),
      );

      logger.info('sudt balance:', balance.toString(4));
      logger.info('expect balance:', new Amount(lockAmount, 4).toString(4));
      return balance.eq(new Amount(lockAmount, 4));
    },
    1000 * 10,
  );

  // send burn tx
  const burnAmount = new Amount('0.0001', 4);
  const generator = new CkbTxGenerator(ckb, new IndexerCollector(indexer));
  const burnTx = await generator.burn(
    await account.getLockscript(),
    lockAccount,
    new EosAsset(lockAsset, ownLockHash),
    burnAmount,
  );
  const signedTx = ckb.signTransaction(PRI_KEY)(burnTx);
  const burnTxHash = await ckb.rpc.sendTransaction(signedTx);
  console.log(`burn Transaction has been sent with tx hash ${burnTxHash}`);
  await waitUntilCommitted(ckb, burnTxHash, 60);

  await waitFnCompleted(
    waitTimeout,
    async (): Promise<boolean> => {
      const balance = await collector.getSUDTBalance(
        new Script(sudtType.codeHash, sudtType.args, sudtType.hashType),
        await account.getLockscript(),
      );

      logger.info('sudt balance:', balance);
      logger.info('expect balance:', new Amount(lockAmount, 4).sub(burnAmount));
      return balance.eq(new Amount(lockAmount, 4).sub(burnAmount));
    },
    1000 * 10,
  );

  //check unlock record send
  let eosUnlockTxHash = '';
  await waitFnCompleted(
    waitTimeout,
    async () => {
      const eosUnlockRecords = await conn.manager.find(EosUnlock, {
        where: {
          ckbTxHash: burnTxHash,
          status: 'success',
        },
      });
      if (eosUnlockRecords.length === 0) {
        return false;
      }
      logger.info('EosUnlockRecords', eosUnlockRecords);
      assert(eosUnlockRecords.length === 1);
      const eosUnlockRecord = eosUnlockRecords[0];
      assert(eosUnlockRecord.recipientAddress == lockAccount);
      assert(eosUnlockRecord.asset === lockAsset);
      logger.info('amount: ', eosUnlockRecord.amount);
      logger.info('amount: ', burnAmount.toString(0));
      assert(eosUnlockRecord.amount === burnAmount.toString(0));
      eosUnlockTxHash = eosUnlockRecord.eosTxHash;
      return true;
    },
    1000 * 10,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
