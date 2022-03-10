import { RPC } from '@ckb-lumos/rpc';
import { WebHook } from '@force-bridge/app-monitor/src/discord';
import { nonNullable } from '@force-bridge/x';
import { CkbIndexer } from '@force-bridge/x/dist/ckb/tx-helper/indexer';
import { ConfigItem } from '@force-bridge/x/dist/config';
import { initLog, logger } from '@force-bridge/x/dist/utils/logger';
import CKB from '@nervosnetwork/ckb-sdk-core';
import { ethers } from 'ethers';
import { JSONRPCClient } from 'json-rpc-2.0';
import fetch from 'node-fetch/index';
import { ckbOriginStressTest } from './stress-ckb-test';
import { ethOriginStressTest } from './stress-test';

function devConfig(): StressConfig {
  // your send lock tx account privkey; * 1. eth needs, 2. ethDai token needs *
  const ethPrivateKey = '';
  // your transfer ckb to recipients account privkey, * 1. ckb needs, 2. dev_token of sudtTypescriptHash needs *
  const ckbPrivateKey = '';
  // for ethOrigin distribute test ckbPrivKeys, * 1. ckb needs *
  const ethOriginUsedCkbPrivateKey = '';
  // for ckbOrigin distribute test ethPrivKeys, * 1. eth needs *
  const ckbOriginUsedEthPrivateKey = '';
  const ethNodeUrl = 'http://127.0.0.1:8545';
  const ckbNodeUrl = 'http://127.0.0.1:8114';
  const ckbIndexerUrl = 'http://127.0.0.1:8116';
  const forceBridgeUrl = 'http://127.0.0.1:8080/force-bridge/api/v1';

  /* ======================== Eth Origin Config Start ======================== */
  /* ------------ Eth Config ------------ */
  const lockEthAmount = '30000000000000';
  const burnEthSudtAmount = '10000000000000';
  /* ------------ Erc20 Config ------------ */
  // erc20 config
  // Dai token
  const erc20TokenAddress = '0x7Af456bf0065aADAB2E6BEc6DaD3731899550b84';
  const lockErc20Amount = '3000000000000000';
  const burnCkbErc20SudtAmount = '1000000000000000';
  /* ======================== Eth Origin Config End ======================== */

  /* ======================== Ckb Origin Config Start ======================== */
  /* ------------ Ckb Config ------------ */
  // ethCKB token
  const xchainCkbTokenAddress = '0xe9B447cA594cB87B8d912040c8981B9696541B82';
  const lockCkbAmount = '30000000000';
  const burnCkbSudtAmount = '10000000000';
  /* ------------ Sudt Config ------------ */
  // DEV_TOKEN in ckb
  const sudtTypescriptHash = '0xdbe7f5b6d2abd5434f9c9e432f678c85b4969a02e1a5db1302387087f7954d45';
  const sudtArgs = '0x49beb8c4c29d06e05452b5d9ea8e86ffd4ea2b614498ba1a0c47890a0ad4f550';
  const xchainSudtTokenAddress = '0xca25Ef1dCA0CB7E352F9651caA409b1056DE124e';
  const lockCkbSudtAmount = '30000000000';
  const burnErc20SudtAmount = '10000000000';
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
    ethOriginUsedCkbPrivateKey,
    ckbOriginUsedEthPrivateKey,
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
  // for ethOrigin distribute test ckbPrivKeys, * 1. ckb needs *
  const ethOriginUsedCkbPrivateKey = '';
  // for ckbOrigin distribute test ethPrivKeys, * 1. eth needs *
  const ckbOriginUsedEthPrivateKey = '';
  // const ethNodeUrl = 'https://rinkeby.infura.io/v3/66c31b146d424cf8a9cb1fba4a6eb32e';
  const ethNodeUrl = 'https://eth-rinkeby.alchemyapi.io/v2/vs-rRAMOinzrHY634csL75yqxfCUvg0U';
  const ckbNodeUrl = 'http://47.56.233.149:3017/rpc';
  const ckbIndexerUrl = 'http://47.56.233.149:3017/indexer';
  const forceBridgeUrl = 'http://8.210.97.124:3060/force-bridge/api/v1';

  /* ======================== Eth Origin Config Start ======================== */
  /* ------------ Eth Config ------------ */
  const lockEthAmount = '30000000000000';
  const burnEthSudtAmount = '10000000000000';
  /* ------------ Erc20 Config ------------ */
  // erc20 config
  // Dai token
  const erc20TokenAddress = '0x7Af456bf0065aADAB2E6BEc6DaD3731899550b84';
  const lockErc20Amount = '3000000000000000';
  const burnCkbErc20SudtAmount = '1000000000000000';
  /* ======================== Eth Origin Config End ======================== */

  /* ======================== Ckb Origin Config Start ======================== */
  /* ------------ Ckb Config ------------ */
  // ethCKB token
  const xchainCkbTokenAddress = '0x9C8CCf938883a427b90aEf5155284cFbcAceECC6';
  const lockCkbAmount = '30000000000';
  const burnCkbSudtAmount = '10000000000';
  /* ------------ Sudt Config ------------ */
  // DEV_TOKEN in ckb
  const sudtTypescriptHash = '0x33ccf0d1d3ff3c58c1afacf3d1a5ae8d68a06b27b8dbfd86625cef1fcbfbaf67';
  const sudtArgs = '0xc247211ab6cc6597506c0aa06bd8a21884678f08fdd3a97f81e43fb24ab48663';
  const xchainSudtTokenAddress = '0xE4a64e37eD454a9e89A04686A8E8759A573Dc91e';
  const lockCkbSudtAmount = '30000000000';
  const burnErc20SudtAmount = '10000000000';
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
    ethOriginUsedCkbPrivateKey,
    ckbOriginUsedEthPrivateKey,
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
  ethOriginUsedCkbPrivateKey: string;
  ckbOriginUsedEthPrivateKey: string;
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

async function stressTest() {
  initLog({ level: 'debug', identity: 'stress-schedule-test', logFile: './data/stress-schedule.log' });
  const bridgeDirection = nonNullable(process.argv[2]);
  const batchNumber = Number(process.argv[3] ?? 100);
  const roundNumber = Number(process.argv[4] ?? 2);

  const {
    ethPrivateKey,
    ckbPrivateKey,
    ethOriginUsedCkbPrivateKey,
    ckbOriginUsedEthPrivateKey,
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
  await Promise.all([
    ethOriginStressTest({
      bridgeDirection,
      batchNumber,
      roundNumber,
      ckb,
      ckbIndexer,
      client,
      provider,
      ethPrivateKey,
      ckbPrivateKey: ethOriginUsedCkbPrivateKey,
      lockEthAmount,
      erc20TokenAddress,
      lockErc20Amount,
      burnEthSudtAmount,
      burnCkbErc20SudtAmount,
    }),
    ckbOriginStressTest({
      bridgeDirection,
      batchNumber,
      roundNumber,
      ckb,
      rpc,
      ckbIndexer,
      client,
      provider,
      ethPrivateKey: ckbOriginUsedEthPrivateKey,
      ckbPrivateKey,
      xchainCkbTokenAddress,
      lockCkbAmount,
      burnCkbSudtAmount,
      sudtTypescript,
      sudtTypescriptHash,
      sudtArgs,
      xchainSudtTokenAddress,
      lockCkbSudtAmount,
      burnErc20SudtAmount,
    }),
  ]);
  logger.info(`stress schedule succeed!`);
}

if (require.main === module) {
  stressTest().catch((error) => {
    logger.error(`stress schedule test failed, error: ${error.stack}`);
    const webHookErrorUrl =
      'https://discord.com/api/webhooks/872779655579586621/YOz4mEuGyLjF97vpQn37PD6Z9N_mtdUyuZpr_uedbB3SCXwLAW77DY5qeqlB7hbQxuYS';
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
}
