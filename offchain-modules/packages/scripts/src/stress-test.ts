import { nonNullable } from '@force-bridge/x';
import { initLog, logger } from '@force-bridge/x/dist/utils/logger';
import CKB from '@nervosnetwork/ckb-sdk-core';
import { AddressPrefix } from '@nervosnetwork/ckb-sdk-utils';
import { ethers } from 'ethers';
import { JSONRPCClient } from 'json-rpc-2.0';
import fetch from 'node-fetch/index';
import { burn, lock, prepareCkbAddresses, prepareCkbPrivateKeys, check } from './utils/eth_batch_test';

// send lock tx
const ethPrivateKey = '0xc4ad657963930fbff2e9de3404b30a4e21432c89952ed430b56bf802945ed37a';
// transfer ckb to recipients
const ckbPrivateKey = '0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe';
const ethNodeUrl = 'http://127.0.0.1:3000';
const ckbNodeUrl = 'http://127.0.0.1:3001';
const ckbIndexerUrl = 'http://127.0.0.1:3002';
const forceBridgeUrl = 'http://127.0.0.1:3199/force-bridge/api/v1';
const ethTokenAddress = '0x0000000000000000000000000000000000000000';
const erc20TokenAddress = '0x7Af456bf0065aADAB2E6BEc6DaD3731899550b84';
const lockEthAmount = '30000000000000';
const burnEthSudtAmount = '10000000000000';
const lockErc20Amount = '3000000000000000';
const burnErc20SudtAmount = '1000000000000000';

// ts-node stress-test.ts [bridgeDirection] [batchNumber] [roundNumber]
// bridgeDirection: in = only test bridge in, both = test bridge in and out
// batchNumber: the number of lock/burn eth/erc20 txes sent one time
// roundNumber: the number of batch round
async function main() {
  initLog({ level: 'debug', identity: 'stress-test' });
  const bridgeDirection = nonNullable(process.argv[2]);
  const batchNumber = Number(process.argv[3] ?? 100);
  const roundNumber = Number(process.argv[4] ?? 2);

  logger.info(
    `start stress test with bridgeDirection=${bridgeDirection}, batchNumber=${batchNumber}, roundNumber=${roundNumber}`,
  );
  const ckb = new CKB(ckbNodeUrl);
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
  const ethWallet = new ethers.Wallet(ethPrivateKey, provider);
  const ethAddress = ethWallet.address;

  const ckbPrivs = prepareCkbPrivateKeys(batchNumber);
  const ckbAddresses = await (async () => {
    if (bridgeDirection === 'in') {
      return ckbPrivs.map((key) =>
        ckb.utils.pubkeyToAddress(ckb.utils.privateKeyToPublicKey(key), { prefix: AddressPrefix.Testnet }),
      );
    }
    return prepareCkbAddresses(ckb, ckbPrivs, ckbPrivateKey, ckbNodeUrl, ckbIndexerUrl);
  })();

  logger.info('start initial round of stress lock test');
  await stressLock(1, batchNumber, client, provider, ethWallet, ckbAddresses, ethNodeUrl);
  logger.info('initial round of stress lock test succeed');

  const stressPromise: PromiseLike<void>[] = [];
  const lockPromise = stressLock(roundNumber - 1, batchNumber, client, provider, ethWallet, ckbAddresses, ethNodeUrl);
  stressPromise.push(lockPromise);
  if (bridgeDirection === 'both') {
    const burnPromise = stressBurn(roundNumber, batchNumber, ckb, client, ckbPrivs, ckbAddresses, ethAddress);
    stressPromise.push(burnPromise);
  }
  await Promise.all(stressPromise);
  logger.info(`stress test succeed!`);
}

async function stressLock(
  roundNumber: number,
  batchNumber: number,
  client: JSONRPCClient,
  provider: ethers.providers.JsonRpcProvider,
  ethWallet: ethers.Wallet,
  recipients: Array<string>,
  ethNodeUrl: string,
  intervalMs = 0,
) {
  for (let i = 0; i < roundNumber; i++) {
    logger.info(`start ${i + 1} round stress lock test`);
    const lockEthTxs = await lock(
      client,
      provider,
      ethWallet,
      recipients,
      ethTokenAddress,
      lockEthAmount,
      ethNodeUrl,
      intervalMs,
    );
    const lockErc20Txs = await lock(
      client,
      provider,
      ethWallet,
      recipients,
      erc20TokenAddress,
      lockErc20Amount,
      ethNodeUrl,
      intervalMs,
    );
    await check(client, lockEthTxs, recipients, batchNumber, ethTokenAddress);
    await check(client, lockErc20Txs, recipients, batchNumber, erc20TokenAddress);
    logger.info(`${i + 1} round stress lock test succeed`);
  }
  logger.info(`stress lock test succeed!`);
}

async function stressBurn(
  roundNumber: number,
  batchNumber: number,
  ckb: CKB,
  client: JSONRPCClient,
  ckbPrivs: Array<string>,
  senders: Array<string>,
  recipient: string,
  intervalMs = 0,
) {
  for (let i = 0; i < roundNumber; i++) {
    logger.info(`start ${i + 1} round stress burn test`);
    const burnEthSudtTxs = await burn(
      ckb,
      client,
      ckbPrivs,
      senders,
      recipient,
      ethTokenAddress,
      burnEthSudtAmount,
      intervalMs,
    );
    await check(client, burnEthSudtTxs, senders, batchNumber, ethTokenAddress);
    const burnErc20SudtTxs = await burn(
      ckb,
      client,
      ckbPrivs,
      senders,
      recipient,
      erc20TokenAddress,
      burnErc20SudtAmount,
      intervalMs,
    );
    await check(client, burnErc20SudtTxs, senders, batchNumber, erc20TokenAddress);
    logger.info(`${i + 1} round stress burn test succeed`);
  }
  logger.info('stress burn test succeed!');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error(`stress test failed, error: ${error.stack}`);
    process.exit(1);
  });
