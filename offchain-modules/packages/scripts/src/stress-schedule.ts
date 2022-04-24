import fs from 'fs';
import { RPC } from '@ckb-lumos/rpc';
import { WebHook } from '@force-bridge/app-monitor/src/discord';
import { CkbIndexer } from '@force-bridge/x/dist/ckb/tx-helper/indexer';
import { initLumosConfig } from '@force-bridge/x/dist/ckb/tx-helper/init_lumos_config';
import { ConfigItem } from '@force-bridge/x/dist/config';
import { initLog, logger } from '@force-bridge/x/dist/utils/logger';
import CKB from '@nervosnetwork/ckb-sdk-core';
import dayjs from 'dayjs';
import { ethers } from 'ethers';
import { JSONRPCClient } from 'json-rpc-2.0';
import fetch from 'node-fetch/index';
import * as schedule from 'node-schedule';
import { ckbOriginStressTest, ckbOriginStressTestAfter, ckbOriginStressTestPrepare } from './stress-ckb-test';
import { ethOriginStressTest, ethOriginStressTestAfter, ethOriginStressTestPrepare } from './stress-test';

initLog({ level: 'debug', identity: 'stress-schedule-test', logFile: './stress-schedule-logs/stress-schedule.log' });
initLumosConfig('AGGRON4');

type StressKey = {
  privateKey: string;
};

type StressKeystore = {
  ethKeystore: StressKey[];
  ckbKeystore: StressKey[];
};

const stressKeystoreConfigPath = './stress-keystore.json';

function devConfig(): StressConfig {
  // your send lock tx account privkey; * 1. eth needs, 2. ethDai token needs *
  const ethPrivateKey = '';
  // your transfer ckb to recipients account privkey, * 1. ckb needs, 2. dev_token of sudtTypescriptHash needs *
  const ckbPrivateKey = '';
  const ethNodeUrl = 'http://127.0.0.1:8545';
  const ckbNodeUrl = 'http://127.0.0.1:8114';
  const ckbIndexerUrl = 'http://127.0.0.1:8116';
  const forceBridgeUrl = 'http://127.0.0.1:8080/force-bridge/api/v1';

  /* ======================== Eth Origin Config Start ======================== */
  /* ------------ Eth Config ------------ */
  const lockEthAmount = '20000000000000';
  const burnEthSudtAmount = '16000000000000';
  /* ------------ Erc20 Config ------------ */
  // erc20 config
  // Dai token
  const erc20TokenAddress = '0x7Af456bf0065aADAB2E6BEc6DaD3731899550b84';
  const lockErc20Amount = '2000000000000000';
  const burnCkbErc20SudtAmount = '1600000000000000';
  /* ======================== Eth Origin Config End ======================== */

  /* ======================== Ckb Origin Config Start ======================== */
  /* ------------ Ckb Config ------------ */
  // ethCKB token
  const xchainCkbTokenAddress = '0xe9B447cA594cB87B8d912040c8981B9696541B82';
  const lockCkbAmount = '20000000000';
  const burnCkbSudtAmount = '16000000000';
  /* ------------ Sudt Config ------------ */
  // DEV_TOKEN in ckb
  const sudtTypescriptHash = '0xdbe7f5b6d2abd5434f9c9e432f678c85b4969a02e1a5db1302387087f7954d45';
  const sudtArgs = '0x49beb8c4c29d06e05452b5d9ea8e86ffd4ea2b614498ba1a0c47890a0ad4f550';
  const xchainSudtTokenAddress = '0xca25Ef1dCA0CB7E352F9651caA409b1056DE124e';
  const lockCkbSudtAmount = '20000000000';
  const burnErc20SudtAmount = '16000000000';
  // cellDep of DEV_TOKEN
  const sudtTypescript: ConfigItem = {
    cellDep: {
      depType: 'code',
      outPoint: {
        txHash: '0x2945442d6373ec50f67922c8ca39ac67534c58420e2183b215b02f1b9f3b4c13',
        index: '0x0',
      },
    },
    script: {
      codeHash: '0xe1e354d6d643ad42724d40967e334984534e0367405c5ae42a9d7d63d77df419',
      hashType: 'data',
    },
  };
  /* ======================== Ckb Origin Config End ======================== */
  return {
    ethPrivateKey,
    ckbPrivateKey,
    ethNodeUrl,
    ckbNodeUrl,
    ckbIndexerUrl,
    forceBridgeUrl,
    lockEthAmount,
    burnEthSudtAmount,
    erc20TokenAddress,
    lockErc20Amount,
    burnCkbErc20SudtAmount,
    xchainCkbTokenAddress,
    lockCkbAmount,
    burnCkbSudtAmount,
    sudtTypescriptHash,
    sudtArgs,
    xchainSudtTokenAddress,
    lockCkbSudtAmount,
    burnErc20SudtAmount,
    sudtTypescript,
  };
}

function testnetConfig(): StressConfig {
  // your send lock tx account privkey; * 1. eth needs, 2. ethDai token needs *
  const ethPrivateKey = '';
  // your transfer ckb to recipients account privkey, * 1. ckb needs, 2. dev_token of sudtTypescriptHash needs *
  const ckbPrivateKey = '';
  // const ethNodeUrl = 'https://rinkeby.infura.io/v3/66c31b146d424cf8a9cb1fba4a6eb32e';
  const ethNodeUrl = 'https://data-seed-prebsc-1-s1.binance.org:8545/';
  const ckbNodeUrl = 'http://47.56.233.149:3017/rpc';
  const ckbIndexerUrl = 'http://47.56.233.149:3017/indexer';
  const forceBridgeUrl = 'http://8.210.97.124:3060/force-bridge/api/v1';

  /* ======================== Eth Origin Config Start ======================== */
  /* ------------ Eth Config ------------ */
  const lockEthAmount = '20000000000000';
  const burnEthSudtAmount = '16000000000000';
  /* ------------ Erc20 Config ------------ */
  // erc20 config
  // USDT token
  const erc20TokenAddress = '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd';
  const lockErc20Amount = '2000000000000000';
  const burnCkbErc20SudtAmount = '1600000000000000';
  /* ======================== Eth Origin Config End ======================== */

  /* ======================== Ckb Origin Config Start ======================== */
  /* ------------ Ckb Config ------------ */
  // ethCKB token
  const xchainCkbTokenAddress = '0xA2F86b2B02Cc615b979Df30736b97B6fE4BBAd1A';
  const lockCkbAmount = '20000000000';
  const burnCkbSudtAmount = '16000000000';
  /* ------------ Sudt Config ------------ */
  // DEV_TOKEN in ckb
  const sudtTypescriptHash = '0x33ccf0d1d3ff3c58c1afacf3d1a5ae8d68a06b27b8dbfd86625cef1fcbfbaf67';
  const sudtArgs = '0xc247211ab6cc6597506c0aa06bd8a21884678f08fdd3a97f81e43fb24ab48663';
  const xchainSudtTokenAddress = '0x8a4911a27714C4424671B3E47EbDD747796DA8dB';
  const lockCkbSudtAmount = '20000000000';
  const burnErc20SudtAmount = '16000000000';
  // cellDep of DEV_TOKEN
  const sudtTypescript: ConfigItem = {
    cellDep: {
      depType: 'code',
      outPoint: {
        txHash: '0xe12877ebd2c3c364dc46c5c992bcfaf4fee33fa13eebdf82c591fc9825aab769',
        index: '0x0',
      },
    },
    script: {
      codeHash: '0xc5e5dcf215925f7ef4dfaf5f4b4f105bc321c02776d6e7d52a1db3fcd9d011a4',
      hashType: 'type',
    },
  };
  /* ======================== Ckb Origin Config End ======================== */
  return {
    ethPrivateKey,
    ckbPrivateKey,
    ethNodeUrl,
    ckbNodeUrl,
    ckbIndexerUrl,
    forceBridgeUrl,
    lockEthAmount,
    burnEthSudtAmount,
    erc20TokenAddress,
    lockErc20Amount,
    burnCkbErc20SudtAmount,
    xchainCkbTokenAddress,
    lockCkbAmount,
    burnCkbSudtAmount,
    sudtTypescriptHash,
    sudtArgs,
    xchainSudtTokenAddress,
    lockCkbSudtAmount,
    burnErc20SudtAmount,
    sudtTypescript,
  };
}

interface StressConfig {
  ethPrivateKey: string;
  ckbPrivateKey: string;
  ethNodeUrl: string;
  ckbNodeUrl: string;
  ckbIndexerUrl: string;
  forceBridgeUrl: string;
  lockEthAmount: string;
  burnEthSudtAmount: string;
  erc20TokenAddress: string;
  lockErc20Amount: string;
  burnCkbErc20SudtAmount: string;
  xchainCkbTokenAddress: string;
  lockCkbAmount: string;
  burnCkbSudtAmount: string;
  sudtTypescriptHash: string;
  sudtArgs: string;
  xchainSudtTokenAddress: string;
  lockCkbSudtAmount: string;
  burnErc20SudtAmount: string;
  sudtTypescript: ConfigItem;
}

async function overAllPrepare(
  stressKeystore: StressKeystore,
  batchNumber: number,
  provider: ethers.providers.JsonRpcProvider,
): Promise<{
  ethOriginEthWallet: ethers.Wallet;
  ethOriginCkbPrivateKeys: string[];
  ckbOriginEthWallets: ethers.Wallet[];
  ckbOriginCkbPrivateKeys: string[];
}> {
  return {
    ethOriginEthWallet: new ethers.Wallet(stressKeystore.ethKeystore[0].privateKey, provider),
    ethOriginCkbPrivateKeys: stressKeystore.ckbKeystore.slice(0, batchNumber).map((k) => k.privateKey),
    ckbOriginEthWallets: stressKeystore.ethKeystore
      .slice(1, 1 + batchNumber)
      .map((k) => k.privateKey)
      .map((pk) => new ethers.Wallet(pk, provider)),
    ckbOriginCkbPrivateKeys: stressKeystore.ckbKeystore
      .slice(batchNumber, batchNumber + batchNumber)
      .map((k) => k.privateKey),
  };
}

async function allPrepareToKeystore(
  ethOriginEthWallet: ethers.Wallet,
  ethOriginCkbPrivateKeys: string[],
  ckbOriginEthWallets: ethers.Wallet[],
  ckbOriginPrivateKeys: string[],
): Promise<StressKeystore> {
  return {
    ethKeystore: [ethOriginEthWallet.privateKey, ...ckbOriginEthWallets.map((w) => w.privateKey)].map((k) => ({
      privateKey: k,
    })),
    ckbKeystore: [...ethOriginCkbPrivateKeys, ...ckbOriginPrivateKeys].map((k) => ({ privateKey: k })),
  };
}

async function stressTest(bridgeDirection: 'in' | 'both', batchNumber: number, roundNumber: number) {
  const ESTIMATE_MAX_BATCH_NUMBER = 200;

  const {
    ethPrivateKey,
    ckbPrivateKey,
    ethNodeUrl,
    ckbNodeUrl,
    ckbIndexerUrl,
    forceBridgeUrl,
    lockEthAmount,
    burnEthSudtAmount,
    erc20TokenAddress,
    lockErc20Amount,
    burnCkbErc20SudtAmount,
    xchainCkbTokenAddress,
    lockCkbAmount,
    burnCkbSudtAmount,
    sudtTypescriptHash,
    sudtArgs,
    xchainSudtTokenAddress,
    lockCkbSudtAmount,
    burnErc20SudtAmount,
    sudtTypescript,
  } = testnetConfig();
  // } = devConfig();

  if (batchNumber > ESTIMATE_MAX_BATCH_NUMBER) {
    logger.error(`batchNumber should be less than ${ESTIMATE_MAX_BATCH_NUMBER}`);
    process.exit(1);
  }

  const ckb = new CKB(ckbNodeUrl);
  const rpc = new RPC(ckbNodeUrl);
  const ckbIndexer = new CkbIndexer(ckbNodeUrl, ckbIndexerUrl);
  const client = new JSONRPCClient((jsonRPCRequest) =>
    fetch(forceBridgeUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(jsonRPCRequest),
      id: 1,
    }).then((response) => {
      if (response.status === 200) {
        // Use client.receive when you received a JSON-RPC response.
        return response.json().then((jsonRPCResponse) => client.receive(jsonRPCResponse));
      } else if (jsonRPCRequest.id !== undefined) {
        return Promise.reject(new Error(response.statusText));
      }
    }),
  );
  const provider = new ethers.providers.JsonRpcProvider(ethNodeUrl);

  const configPath = process.env.STRESS_KEYSTORE_CONFIG_PATH || stressKeystoreConfigPath;

  if (!fs.existsSync(configPath)) {
    const { ethWallet: ethOriginEthWallet, ckbPrivateKeys: ethOriginCkbPrivateKeys } = await ethOriginStressTestPrepare(
      {
        bridgeDirection,
        batchNumber: ESTIMATE_MAX_BATCH_NUMBER,
        ckb,
        ckbIndexer,
        provider,
        ethPrivateKey,
        ckbPrivateKey,
      },
    );
    const { ethWallets: ckbOriginEthWallets, ckbPrivateKeys: ckbOriginPrivateKeys } = await ckbOriginStressTestPrepare({
      batchNumber: ESTIMATE_MAX_BATCH_NUMBER,
      roundNumber,
      ckb,
      ckbIndexer,
      provider,
      ethPrivateKey,
      ckbPrivateKey,
      lockCkbAmount,
      sudtTypescript,
      sudtArgs,
      lockCkbSudtAmount,
    });
    const stressKeystore: StressKeystore = await allPrepareToKeystore(
      ethOriginEthWallet,
      ethOriginCkbPrivateKeys,
      ckbOriginEthWallets,
      ckbOriginPrivateKeys,
    );
    fs.writeFileSync(configPath, JSON.stringify(stressKeystore, null, 2));
  }
  logger.info(`load config file: ${configPath}`);
  const data = fs.readFileSync(configPath);
  const stressKeystore: StressKeystore = JSON.parse(data.toString()) as StressKeystore;
  const { ethOriginEthWallet, ethOriginCkbPrivateKeys, ckbOriginEthWallets, ckbOriginCkbPrivateKeys } =
    await overAllPrepare(stressKeystore, batchNumber, provider);

  const stressTestPromises: PromiseLike<unknown>[] = [];
  stressTestPromises.push(
    ethOriginStressTest({
      bridgeDirection,
      batchNumber,
      roundNumber,
      ckb,
      client,
      provider,
      ethWallet: ethOriginEthWallet,
      ckbPrivateKeys: ethOriginCkbPrivateKeys,
      lockEthAmount,
      erc20TokenAddress,
      lockErc20Amount,
      burnEthSudtAmount,
      burnCkbErc20SudtAmount,
    }),
  );
  stressTestPromises.push(
    ckbOriginStressTest({
      bridgeDirection,
      batchNumber,
      roundNumber,
      ckb,
      rpc,
      client,
      provider,
      ethWallets: ckbOriginEthWallets,
      ckbPrivateKeys: ckbOriginCkbPrivateKeys,
      xchainCkbTokenAddress,
      lockCkbAmount,
      burnCkbSudtAmount,
      sudtTypescriptHash,
      xchainSudtTokenAddress,
      lockCkbSudtAmount,
      burnErc20SudtAmount,
    }),
  );
  await Promise.all(stressTestPromises);
  logger.info(`stress schedule succeed!`);
  await ethOriginStressTestAfter();
  await ckbOriginStressTestAfter();
}

function logToDiscord(log: string) {
  logger.info(log);
  const webHookUrl =
    'https://discord.com/api/webhooks/945223969496240138/BsvWvYBEttKWeO-din1fMh4lffk9juP_BkIKhMLho-Z7wC1_H-lJbFWe7j-iMqkh7iWv';
  new WebHook(webHookUrl)
    .setTitle('stress-schedule job log')
    .setDescription(log)
    .addTimeStamp()
    .info()
    .send()
    .then(() => {
      logger.info(`sent schedule job log ${log} to discord`);
    });
}

function main() {
  let running = false;
  let benchReady = false;
  const usualJob = schedule.scheduleJob('0 0 0/1 * * ?', () => {
    if (running || benchReady) {
      logToDiscord(`usualJob conflict running: ${running} benchReady: ${benchReady}`);
      return;
    }
    logToDiscord(`usualJob start at ${dayjs().toISOString()}`);
    running = true;
    stressTest('both', 3, 2)
      .then(() => {
        logToDiscord(`usualJob end at ${dayjs().toISOString()}`);
        running = false;
      })
      .catch((error) => {
        logToDiscord(`usualJob error at ${dayjs().toISOString()}`);
        running = false;
        logger.error(`stress schedule test failed, error: ${error.stack}`);
        const webHookErrorUrl =
          'https://discord.com/api/webhooks/946301786938015755/gW2CEtVgXkG6ehyYsbcPbbdM1jeyXes3hKtz0Klk5yJDjWd-8R0Q6eOFvwKmd9XbRWIT';
        new WebHook(webHookErrorUrl)
          .setTitle('stress-schedule test error')
          .setDescription(error.stack)
          .addTimeStamp()
          .error()
          .send()
          .then(() => {
            logger.info('sent stress schedule error to discord');
            process.exit(1);
          });
      });
  });

  const benchReadyJob = schedule.scheduleJob('0 30 0 * * ?', () => {
    logToDiscord(`bench job ready, set benchReady = true`);
    benchReady = true;
  });

  const benchJob = schedule.scheduleJob('0 0 1 * * ?', () => {
    const jobContent = () => {
      if (running || !benchReady) {
        logToDiscord(`benchJob conflict running: ${running} benchReady: ${benchReady}`);
        benchReady = true;
        setTimeout(jobContent, 5 * 60 * 1000);
        return;
      }
      logToDiscord(`benchJob start at ${dayjs().toISOString()}`);
      running = true;
      stressTest('both', 100, 1)
        .then(() => {
          logToDiscord(`benchJob end at ${dayjs().toISOString()}`);
          running = false;
          benchReady = false;
        })
        .catch((error) => {
          logToDiscord(`benchJob error at ${dayjs().toISOString()}`);
          running = false;
          benchReady = false;
          logger.error(`stress schedule test failed, error: ${error.stack}`);
          const webHookErrorUrl =
            'https://discord.com/api/webhooks/946301786938015755/gW2CEtVgXkG6ehyYsbcPbbdM1jeyXes3hKtz0Klk5yJDjWd-8R0Q6eOFvwKmd9XbRWIT';
          new WebHook(webHookErrorUrl)
            .setTitle('stress-schedule test error')
            .setDescription(error.stack)
            .addTimeStamp()
            .error()
            .send()
            .then(() => {
              logger.info('sent stress schedule error to discord');
              process.exit(1);
            });
        });
    };
    jobContent();
  });
  logger.info(`start usualJob ${usualJob.name} benchReadyJob ${benchReadyJob.name} benchJob ${benchJob.name}`);
}

if (require.main === module) {
  main();
  /*
  stressTest('both', 1, 1)
    .then(() => {
      logToDiscord(`benchJob end at ${dayjs().toISOString()}`);
    })
    .catch((error) => {
      logToDiscord(`benchJob error at ${dayjs().toISOString()}`);
      logger.error(`stress schedule test failed, error: ${error.stack}`);
      const webHookErrorUrl =
        'https://discord.com/api/webhooks/946301786938015755/gW2CEtVgXkG6ehyYsbcPbbdM1jeyXes3hKtz0Klk5yJDjWd-8R0Q6eOFvwKmd9XbRWIT';
      new WebHook(webHookErrorUrl)
        .setTitle('stress-schedule test error')
        .setDescription(error.stack)
        .addTimeStamp()
        .error()
        .send()
        .then(() => {
          logger.info('sent stress schedule error to discord');
          process.exit(1);
        });
    });
   */
}
