import { RPC } from '@ckb-lumos/rpc';
import { nonNullable } from '@force-bridge/x';
import { CkbIndexer } from '@force-bridge/x/dist/ckb/tx-helper/indexer';
import { ETH_TOKEN_ADDRESS } from '@force-bridge/x/dist/config';
import { initLog, logger } from '@force-bridge/x/dist/utils/logger';
import CKB from '@nervosnetwork/ckb-sdk-core';
import { AddressPrefix } from '@nervosnetwork/ckb-sdk-utils';
import { ethers } from 'ethers';
import { JSONRPCClient } from 'json-rpc-2.0';
import fetch from 'node-fetch/index';
import { burn, lock, prepareCkbAddresses, prepareCkbPrivateKeys, check } from './utils/eth_batch_test';

// ts-node stress-test.ts [bridgeDirection] [batchNumber] [roundNumber]
// bridgeDirection: in = only test bridge in, both = test bridge in and out
// batchNumber: the number of lock/burn eth/erc20 txes sent one time
// roundNumber: the number of batch round
async function main() {
  initLog({ level: 'debug', identity: 'stress-test' });

  // your send lock tx account privkey
  const ethPrivateKey = '';
  // your transfer ckb to recipients account privkey
  const ckbPrivateKey = '';
  const ethNodeUrl = 'http://127.0.0.1:3000';
  const ckbNodeUrl = 'http://127.0.0.1:3001';
  const ckbIndexerUrl = 'http://127.0.0.1:3002';
  const forceBridgeUrl = 'http://127.0.0.1:3199/force-bridge/api/v1';
  // Dai token
  const erc20TokenAddress = '0x7Af456bf0065aADAB2E6BEc6DaD3731899550b84';
  const lockEthAmount = '20000000000000';
  const burnEthSudtAmount = '16000000000000';
  const lockErc20Amount = '2000000000000000';
  const burnCkbErc20SudtAmount = '1600000000000000';

  const bridgeDirection = nonNullable(process.argv[2]);
  const batchNumber = Number(process.argv[3] ?? 100);
  const roundNumber = Number(process.argv[4] ?? 2);
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
  const { ethWallet: ethOriginEthWallet, ckbPrivateKeys: ethOriginCkbPrivateKeys } = await ethOriginStressTestPrepare({
    bridgeDirection,
    batchNumber,
    ckb,
    ckbIndexer,
    provider,
    ethPrivateKey,
    ckbPrivateKey,
  });
  await ethOriginStressTest({
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
  });
}

export async function ethOriginStressTestPrepare({
  bridgeDirection,
  batchNumber,
  ckb,
  ckbIndexer,
  provider,
  ethPrivateKey,
  ckbPrivateKey,
}: {
  bridgeDirection: string;
  batchNumber: number;
  ckb: CKB;
  ckbIndexer: CkbIndexer;
  provider: ethers.providers.JsonRpcProvider;
  ethPrivateKey: string;
  ckbPrivateKey: string;
}): Promise<{ ethWallet: ethers.Wallet; ckbPrivateKeys: string[] }> {
  logger.info(`start stress eth test prepare`);

  const ethWallet = new ethers.Wallet(ethPrivateKey, provider);
  const ckbPrivateKeys = prepareCkbPrivateKeys(batchNumber);
  logger.info(`eth origin stress eth test prepared ckbPrivateKeys ${ckbPrivateKeys}`);
  if (bridgeDirection !== 'in') {
    await prepareCkbAddresses(ckb, ckbIndexer, ckbPrivateKeys, ckbPrivateKey);
  }
  logger.info(`start stress eth test prepare finished`);
  return { ethWallet, ckbPrivateKeys };
}

export async function ethOriginStressTest({
  bridgeDirection,
  batchNumber,
  roundNumber,
  ckb,
  client,
  provider,
  ethWallet,
  ckbPrivateKeys,
  lockEthAmount,
  erc20TokenAddress,
  lockErc20Amount,
  burnEthSudtAmount,
  burnCkbErc20SudtAmount,
}: {
  bridgeDirection: string;
  batchNumber: number;
  roundNumber: number;
  ckb: CKB;
  client: JSONRPCClient;
  provider: ethers.providers.JsonRpcProvider;
  ethWallet: ethers.Wallet;
  ckbPrivateKeys: string[];
  lockEthAmount: string;
  erc20TokenAddress: string;
  lockErc20Amount: string;
  burnEthSudtAmount: string;
  burnCkbErc20SudtAmount: string;
}) {
  logger.info(
    `start stress eth test with bridgeDirection=${bridgeDirection}, batchNumber=${batchNumber}, roundNumber=${roundNumber}`,
  );
  const ethAddress = ethWallet.address;
  const ckbAddresses = ckbPrivateKeys.map((pk) =>
    ckb.utils.pubkeyToAddress(ckb.utils.privateKeyToPublicKey(pk), { prefix: AddressPrefix.Testnet }),
  );

  logger.info('start initial round of stress eth lock test');
  await stressLock(
    1,
    batchNumber,
    client,
    provider,
    ethWallet,
    ckbAddresses,
    lockEthAmount,
    erc20TokenAddress,
    lockErc20Amount,
  );
  logger.info('initial round of stress eth lock test succeed');

  const stressPromise: PromiseLike<void>[] = [];
  const lockPromise = stressLock(
    roundNumber - 1,
    batchNumber,
    client,
    provider,
    ethWallet,
    ckbAddresses,
    lockEthAmount,
    erc20TokenAddress,
    lockErc20Amount,
  );
  stressPromise.push(lockPromise);
  if (bridgeDirection === 'both') {
    const burnPromise = stressBurn(
      roundNumber,
      batchNumber,
      ckb,
      client,
      ckbPrivateKeys,
      ckbAddresses,
      ethAddress,
      burnEthSudtAmount,
      erc20TokenAddress,
      burnCkbErc20SudtAmount,
    );
    stressPromise.push(burnPromise);
  }
  await Promise.all(stressPromise);
  logger.info(`stress eth test succeed!`);
}

export async function ethOriginStressTestAfter() {
  logger.info(`start stress eth test after`);
  // TODO transfer and bridge
}

async function stressLock(
  roundNumber: number,
  batchNumber: number,
  client: JSONRPCClient,
  provider: ethers.providers.JsonRpcProvider,
  ethWallet: ethers.Wallet,
  recipients: Array<string>,
  lockEthAmount: string,
  erc20TokenAddress: string,
  lockErc20Amount: string,
  intervalMs = 5000,
) {
  for (let i = 0; i < roundNumber; i++) {
    logger.info(`start ${i + 1} round stress eth lock test`);
    const lockEthTxs = await lock(
      client,
      provider,
      ethWallet,
      recipients,
      ETH_TOKEN_ADDRESS,
      lockEthAmount,
      intervalMs,
    );
    await check(client, lockEthTxs, recipients, batchNumber, ETH_TOKEN_ADDRESS);
    const lockErc20Txs = await lock(
      client,
      provider,
      ethWallet,
      recipients,
      erc20TokenAddress,
      lockErc20Amount,
      intervalMs,
    );
    await check(client, lockErc20Txs, recipients, batchNumber, erc20TokenAddress);
    logger.info(`${i + 1} round stress eth lock test succeed`);
  }
  logger.info(`stress eth lock test succeed!`);
}

async function stressBurn(
  roundNumber: number,
  batchNumber: number,
  ckb: CKB,
  client: JSONRPCClient,
  ckbPrivs: Array<string>,
  senders: Array<string>,
  recipient: string,
  burnEthSudtAmount: string,
  erc20TokenAddress: string,
  burnCkbErc20SudtAmount: string,
  intervalMs = 5000,
) {
  for (let i = 0; i < roundNumber; i++) {
    logger.info(`start ${i + 1} round stress burn test`);
    const burnEthSudtTxs = await burn(
      ckb,
      client,
      ckbPrivs,
      senders,
      recipient,
      ETH_TOKEN_ADDRESS,
      burnEthSudtAmount,
      intervalMs,
    );
    await check(client, burnEthSudtTxs, senders, batchNumber, ETH_TOKEN_ADDRESS);
    const burnErc20SudtTxs = await burn(
      ckb,
      client,
      ckbPrivs,
      senders,
      recipient,
      erc20TokenAddress,
      burnCkbErc20SudtAmount,
      intervalMs,
    );
    await check(client, burnErc20SudtTxs, senders, batchNumber, erc20TokenAddress);
    logger.info(`${i + 1} round stress burn test succeed`);
  }
  logger.info('stress burn test succeed!');
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error(`stress eth test failed, error: ${error.stack}`);
      process.exit(1);
    });
}
