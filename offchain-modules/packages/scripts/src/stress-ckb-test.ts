import { RPC } from '@ckb-lumos/rpc';
import { nonNullable } from '@force-bridge/x';
import { CkbIndexer } from '@force-bridge/x/dist/ckb/tx-helper/indexer';
import { ConfigItem, CKB_TYPESCRIPT_HASH } from '@force-bridge/x/dist/config';
import { initLog, logger } from '@force-bridge/x/dist/utils/logger';
import CKB from '@nervosnetwork/ckb-sdk-core';
import { AddressPrefix, privateKeyToAddress } from '@nervosnetwork/ckb-sdk-utils';
import { ethers } from 'ethers';
import { JSONRPCClient } from 'json-rpc-2.0';
import fetch from 'node-fetch/index';
import {
  burn,
  lock,
  prepareCkbAddresses,
  prepareCkbPrivateKeys,
  prepareEthWallets,
  check,
} from './utils/ckb_batch_test';

// ts-node stress-test.ts [bridgeDirection] [batchNumber] [roundNumber]
// bridgeDirection: lock = only test bridge lock, both = test bridge lock and burn
// batchNumber: the number of lock/burn eth/erc20 txes sent one time
// roundNumber: the number of batch round
async function main() {
  initLog({ level: 'debug', identity: 'stress-ckb-test' });
  // your send lock tx account privkey
  const ethPrivateKey = '';
  // your transfer ckb to recipients account privkey
  const ckbPrivateKey = '';
  const ethNodeUrl = 'http://127.0.0.1:8545';
  const ckbNodeUrl = 'http://127.0.0.1:8114';
  const ckbIndexerUrl = 'http://127.0.0.1:8116';
  const forceBridgeUrl = 'http://127.0.0.1:8080/force-bridge/api/v1';
  const xchainCkbTokenAddress = '0xe9B447cA594cB87B8d912040c8981B9696541B82';
  const lockCkbAmount = '30000000000';
  const burnCkbSudtAmount = '10000000000';

  // test BBB
  const sudtTypescriptHash = '0xdbe7f5b6d2abd5434f9c9e432f678c85b4969a02e1a5db1302387087f7954d45';
  const sudtArgs = '0x49beb8c4c29d06e05452b5d9ea8e86ffd4ea2b614498ba1a0c47890a0ad4f550';
  const xchainSudtTokenAddress = '0xca25Ef1dCA0CB7E352F9651caA409b1056DE124e';
  const lockCkbSudtAmount = '30000000000';
  const burnErc20SudtAmount = '10000000000';

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
  await ckbOriginStressTest({
    bridgeDirection,
    batchNumber,
    roundNumber,
    ckb,
    rpc,
    ckbIndexer,
    client,
    provider,
    ethPrivateKey,
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
  });
}

export async function ckbOriginStressTest({
  bridgeDirection,
  batchNumber,
  roundNumber,
  ckb,
  rpc,
  ckbIndexer,
  client,
  provider,
  ethPrivateKey,
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
}: {
  bridgeDirection: string;
  batchNumber: number;
  roundNumber: number;
  ckb: CKB;
  rpc: RPC;
  ckbIndexer: CkbIndexer;
  client: JSONRPCClient;
  provider: ethers.providers.JsonRpcProvider;
  ethPrivateKey: string;
  ckbPrivateKey: string;
  xchainCkbTokenAddress: string;
  lockCkbAmount: string;
  burnCkbSudtAmount: string;
  sudtTypescript: ConfigItem;
  sudtTypescriptHash: string;
  sudtArgs: string;
  xchainSudtTokenAddress: string;
  lockCkbSudtAmount: string;
  burnErc20SudtAmount: string;
}) {
  logger.info(
    `start stress ckb test with bridgeDirection=${bridgeDirection}, batchNumber=${batchNumber}, roundNumber=${roundNumber}`,
  );

  const ckbPrivateKeys = prepareCkbPrivateKeys(batchNumber);
  logger.info(`ckbPrivateKeys ${ckbPrivateKeys}`);
  const ckbAddresses = await prepareCkbAddresses(
    ckb,
    ckbIndexer,
    roundNumber,
    ckbPrivateKeys,
    ckbPrivateKey,
    lockCkbAmount,
    sudtTypescript,
    sudtArgs,
    lockCkbSudtAmount,
  );
  logger.info(`prepared ckb addresses ${ckbAddresses}`);

  const ethWallets = await prepareEthWallets(provider, ethPrivateKey, batchNumber, '10000000000000000');
  const recipients = ethWallets.map((ethWallet) => ethWallet.address);
  logger.info(`ethPrivateKeys ${ethWallets.map((ethWallet) => ethWallet.privateKey)} recipients: ${recipients}`);
  logger.info('start stress lock test');
  await stressLock(
    1,
    rpc,
    client,
    ckbPrivateKeys,
    recipients,
    lockCkbAmount,
    sudtTypescriptHash,
    lockCkbSudtAmount,
    0,
    roundNumber,
  );
  logger.info('initial round of stress lock test succeed');
  const stressPromise: PromiseLike<void>[] = [];
  const lockPromise = stressLock(
    roundNumber,
    rpc,
    client,
    ckbPrivateKeys,
    recipients,
    lockCkbAmount,
    sudtTypescriptHash,
    lockCkbSudtAmount,
  );
  stressPromise.push(lockPromise);
  if (bridgeDirection === 'both') {
    const burnPromise = stressBurn(
      roundNumber,
      batchNumber,
      client,
      provider,
      ethWallets,
      ckbAddresses,
      xchainCkbTokenAddress,
      burnCkbSudtAmount,
      xchainSudtTokenAddress,
      burnErc20SudtAmount,
    );
    stressPromise.push(burnPromise);
  }
  await Promise.all(stressPromise);
  logger.info(`stress test succeed!`);
}

async function stressLock(
  roundNumber: number,
  rpc: RPC,
  client: JSONRPCClient,
  ckbPrivateKeys: Array<string>,
  recipients: Array<string>,
  lockCkbAmount: string,
  sudtTypescriptHash: string,
  lockCkbSudtAmount: string,
  intervalMs = 0,
  multiple = 1,
) {
  for (let i = 0; i < roundNumber; i++) {
    const ckbAddresses = ckbPrivateKeys.map((ckbPk) => privateKeyToAddress(ckbPk, { prefix: AddressPrefix.Testnet }));
    logger.info(`start ${i + 1} round stress ckb lock test`);
    const lockCkbTxs = await lock(
      client,
      rpc,
      ckbPrivateKeys,
      ckbAddresses,
      recipients,
      CKB_TYPESCRIPT_HASH,
      (BigInt(lockCkbAmount) * BigInt(multiple)).toString(10),
      intervalMs,
    );
    await check(client, 1, 'Nervos', CKB_TYPESCRIPT_HASH, 'Ethereum', recipients, lockCkbTxs);
    const lockErc20Txs = await lock(
      client,
      rpc,
      ckbPrivateKeys,
      ckbAddresses,
      recipients,
      sudtTypescriptHash,
      (BigInt(lockCkbSudtAmount) * BigInt(multiple)).toString(10),
      intervalMs,
    );
    await check(client, 1, 'Nervos', sudtTypescriptHash, 'Ethereum', recipients, lockErc20Txs);
    logger.info(`${i + 1} round stress ckb lock test succeed`);
  }
  logger.info(`stress ckb lock test succeed!`);
}

async function stressBurn(
  roundNumber: number,
  batchNumber: number,
  client: JSONRPCClient,
  provider: ethers.providers.JsonRpcProvider,
  ethWallets: Array<ethers.Wallet>,
  recipients: Array<string>,
  xchainCkbTokenAddress: string,
  burnCkbSudtAmount: string,
  xchainSudtTokenAddress: string,
  burnErc20SudtAmount: string,
  intervalMs = 0,
) {
  logger.info(`start stress burn test`);
  const burnCkbSudtTxs = await burn(
    client,
    provider,
    ethWallets,
    recipients,
    xchainCkbTokenAddress,
    burnCkbSudtAmount,
    intervalMs,
  );
  await check(
    client,
    batchNumber,
    'Nervos',
    xchainCkbTokenAddress,
    'Ethereum',
    ethWallets.map((ethWallet) => ethWallet.address),
    burnCkbSudtTxs,
  );
  const burnXchainSudtTxs = await burn(
    client,
    provider,
    ethWallets,
    recipients,
    xchainSudtTokenAddress,
    burnErc20SudtAmount,
    intervalMs,
  );
  await check(
    client,
    batchNumber,
    'Nervos',
    xchainSudtTokenAddress,
    'Ethereum',
    ethWallets.map((ethWallet) => ethWallet.address),
    burnXchainSudtTxs,
  );
  logger.info('stress ckb burn test succeed!');
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error(`stress ckb test failed, error: ${error.stack}`);
      process.exit(1);
    });
}
