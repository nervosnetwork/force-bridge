import { createConnection } from 'typeorm';
import 'module-alias/register';
import nconf from 'nconf';
import { EosConfig } from '@force-bridge/config';
import { logger } from '@force-bridge/utils/logger';
import { JsSignatureProvider } from 'eosjs/dist/eosjs-jssig';
import { CkbDb } from '@force-bridge/db';
import { EosLock } from '@force-bridge/db/entity/EosLock';
import { asyncSleep, genRandomHex } from '@force-bridge/utils';
import assert from 'assert';
import { CkbMint } from '@force-bridge/db/entity/CkbMint';
import { ChainType } from '@force-bridge/ckb/model/asset';
import { EosUnlock } from '@force-bridge/db/entity/EosUnlock';
import { EosChain } from '@force-bridge/xchain/eos/eosChain';

type waitFn = () => Promise<boolean>;

async function waitFnCompleted(timeout: number, fn: waitFn, sleepTime = 1000) {
  const start = new Date().getTime();
  while (true) {
    if (await fn()) {
      return;
    }
    if (new Date().getTime() - start < 0) {
      throw new Error(`waitFnCompleted timeout after:${timeout}`);
    }
    await asyncSleep(sleepTime);
  }
}

async function main() {
  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const config: EosConfig = nconf.get('forceBridge:eos');
  logger.debug('EosConfig:', config);

  const rpcUrl = config.rpcUrl;
  const lockAccount = 'spongebob111';
  const lockAccountPri = ['5KQ1LgoXrSLiUMS8HZp6rSuyyJP5i6jTi1KWbZNerQQLFeTrxac'];
  const chain = new EosChain(rpcUrl, new JsSignatureProvider(lockAccountPri));
  const conn = await createConnection();
  const ckbDb = new CkbDb(conn);

  //lock eos
  const recipientLockscript = '0x00';
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
    logger.debug('EosLockTx:', lockTxRes);
  } else {
    throw new Error('send lock eos transaction failed. txRes:' + lockTxRes);
  }

  //check EosLock and EosMint saved.
  const waitTimeout = 1000 * 60 * 3; //3 minutes
  await waitFnCompleted(
    waitTimeout,
    async (): Promise<boolean> => {
      const eosLockRecords = await conn.manager.find(EosLock, {
        where: {
          txHash: lockTxHash,
        },
      });
      const ckbMintRecords = await conn.manager.find(CkbMint, {
        where: {
          id: lockTxHash,
        },
      });
      if (eosLockRecords.length == 0 || ckbMintRecords.length === 0) {
        return false;
      }

      logger.debug('EosLockRecords', eosLockRecords);
      logger.debug('CkbMintRecords', ckbMintRecords);

      assert(eosLockRecords.length === 1);
      const eosLockRecord = eosLockRecords[0];
      assert(eosLockRecord.amount === lockAmount);
      assert(eosLockRecord.token === lockAsset);
      assert(eosLockRecord.memo === memo);
      assert(eosLockRecord.sender === lockAccount);

      assert(ckbMintRecords.length === 1);
      const ckbMintRecord = ckbMintRecords[0];
      assert(ckbMintRecord.chain === ChainType.EOS);
      assert(ckbMintRecord.asset === lockAsset);
      assert(ckbMintRecord.amount === lockAmount);
      assert(ckbMintRecord.recipientLockscript === recipientLockscript);
      return true;
    },
    1000 * 10,
  );

  //unlock eos
  const unlockRecord = {
    ckbTxHash: genRandomHex(32),
    asset: lockAsset,
    amount: lockAmount,
    recipientAddress: lockAccount,
  };
  await ckbDb.createEosUnlock([unlockRecord]);

  //check unlock record send
  let eosUnlockTxHash = '';
  await waitFnCompleted(
    waitTimeout,
    async () => {
      const eosUnlockRecords = await conn.manager.find(EosUnlock, {
        where: {
          ckbTxHash: unlockRecord.ckbTxHash,
          status: 'success',
        },
      });
      if (eosUnlockRecords.length === 0) {
        return false;
      }
      logger.debug('EosUnlockRecords', eosUnlockRecords);
      assert(eosUnlockRecords.length === 1);
      const eosUnlockRecord = eosUnlockRecords[0];
      assert(eosUnlockRecord.recipientAddress == unlockRecord.recipientAddress);
      assert(eosUnlockRecord.asset === unlockRecord.asset);
      assert(eosUnlockRecord.amount === unlockRecord.amount);
      eosUnlockTxHash = eosUnlockRecord.eosTxHash;
      return true;
    },
    1000 * 10,
  );

  if (eosUnlockTxHash !== '') {
    const eosUnlockTx = await chain.getTransaction(eosUnlockTxHash);
    logger.debug('EosUnlockTx:', eosUnlockTx);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
