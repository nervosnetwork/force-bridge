import { Config } from '@force-bridge/x/dist/config';
import { asyncSleep } from '@force-bridge/x/dist/utils';
import { initLog, logger } from '@force-bridge/x/dist/utils/logger';

import CKB from '@nervosnetwork/ckb-sdk-core/';
import { AddressPrefix } from '@nervosnetwork/ckb-sdk-utils';

import { ethers } from 'ethers';
import { JSONRPCClient } from 'json-rpc-2.0';
import nconf from 'nconf';
import fetch from 'node-fetch/index';

const BATCH_NUM = 100;
const LOCK_AMOUNT = '2000000000000000';
const BURN_AMOUNT = '1000000000000000';
const ETH_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000';

const FORCE_BRIDGE_URL = process.env.FORCE_BRIDGE_RPC_URL || 'http://127.0.0.1:8080/force-bridge/api/v1';

const ETH_NODE_URL = process.env.ETH_URL || 'http://127.0.0.1:8545';
const ETH_PRI = process.env.ETH_PRIV_KEY || '0xc4ad657963930fbff2e9de3404b30a4e21432c89952ed430b56bf802945ed37a';

const CKB_NODE_URL = process.env.CKB_URL || 'http://127.0.0.1:8114';
const CKB_PRI = process.env.CKB_PRIV_KEY || '0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe';

// const FORCE_BRIDGE_URL = 'http://47.56.233.149:3083/force-bridge/api/v1';

// const ETH_NODE_URL = 'https://rinkeby.infura.io/v3/48be8feb3f9c46c397ceae02a0dbc7ae';
// const ETH_PRI = '0x59f202ac967ed2efb2aba3d99dd0375574fec015b4b3864215e99017c59e358a';

// const CKB_NODE_URL = 'https://testnet.ckbapp.dev';
// const CKB_PRI = '0x59f202ac967ed2efb2aba3d99dd0375574fec015b4b3864215e99017c59e358a';

const ckb = new CKB(CKB_NODE_URL);

const client = new JSONRPCClient((jsonRPCRequest) =>
  fetch(FORCE_BRIDGE_URL, {
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

async function generateLockTx(
  ethWallet: ethers.Wallet,
  assetIdent: string,
  nonce: number,
  recipient: string,
  amount: string,
): Promise<string> {
  const lockPayload = {
    sender: ethWallet.address,
    recipient: recipient,
    asset: {
      network: 'Ethereum',
      ident: assetIdent,
      amount: amount,
    },
  };
  const unsignedLockTx = await client.request('generateBridgeInNervosTransaction', lockPayload);
  logger.info('unsignedMintTx', unsignedLockTx);

  const provider = new ethers.providers.JsonRpcProvider(ETH_NODE_URL);

  const unsignedTx = unsignedLockTx.rawTransaction;
  unsignedTx.value = unsignedTx.value ? ethers.BigNumber.from(unsignedTx.value.hex) : ethers.BigNumber.from(0);
  unsignedTx.nonce = nonce;
  unsignedTx.gasLimit = ethers.BigNumber.from(1000000);
  unsignedTx.gasPrice = await provider.getGasPrice();

  logger.info('unsignedTx', unsignedTx);

  const signedTx = await ethWallet.signTransaction(unsignedTx);
  logger.info('signedTx', signedTx);

  const hexTx = await Promise.resolve(signedTx).then((t) => ethers.utils.hexlify(t));
  return hexTx;
}

async function generateBurnTx(
  asset: string,
  ckbPriv: string,
  sender: string,
  recipient: string,
  amount: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const burnPayload = {
    network: 'Ethereum',
    sender: sender,
    recipient: recipient,
    asset: asset,
    amount: amount,
  };

  for (let i = 0; i < 5; i++) {
    try {
      const unsignedBurnTx = await client.request('generateBridgeOutNervosTransaction', burnPayload);
      logger.info('unsignedBurnTx ', unsignedBurnTx);

      const signedTx = ckb.signTransaction(ckbPriv)(unsignedBurnTx.rawTransaction);
      logger.info('signedTx', signedTx);
      return signedTx;
    } catch (e) {
      if (i == 4) {
        throw e;
      }
      logger.error('generateBridgeOutNervosTransaction error', e);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getTransaction(assetIdent: string, userIdent: string): Promise<any> {
  const getTxPayload = {
    network: 'Ethereum',
    xchainAssetIdent: assetIdent,
    user: {
      network: 'Nervos',
      ident: userIdent,
    },
  };

  const txs = await client.request('getBridgeTransactionSummaries', getTxPayload);

  return txs;
}

async function checkTx(assetIdent: string, txId: string, userIdent: string) {
  let find = false;
  let pending = false;
  for (let i = 0; i < 600; i++) {
    const txs = await getTransaction(assetIdent, userIdent);
    for (const tx of txs) {
      if (tx.txSummary.fromTransaction.txId == txId) {
        logger.info('tx', tx);
      }
      if (tx.status == 'Successful' && tx.txSummary.fromTransaction.txId == txId) {
        find = true;
        pending = false;
        break;
      }
      if (tx.status == 'Failed' && tx.txSummary.fromTransaction.txId == txId) {
        throw new Error(`rpc test failed, ${txId} occurs error ${tx.message}`);
      }
      if (tx.status == 'Pending' && tx.txSummary.fromTransaction.txId == txId) {
        pending = true;
      }
    }
    if (find) {
      break;
    }
    await asyncSleep(3000);
  }
  if (pending) {
    throw new Error(`rpc test failed, pending for 3000s ${txId}`);
  }
  if (!find) {
    throw new Error(`rpc test failed, can not find record ${txId}`);
  }
}

async function lock(
  provider: ethers.providers.JsonRpcProvider,
  ethWallet: ethers.Wallet,
  recipient: string,
): Promise<Array<string>> {
  const signedLockTxs = new Array<string>();
  const lockTxHashes = new Array<string>();
  const startNonce = await ethWallet.getTransactionCount();

  for (let i = 0; i < BATCH_NUM; i++) {
    const signedLockTx = await generateLockTx(ethWallet, ETH_TOKEN_ADDRESS, startNonce + i, recipient, LOCK_AMOUNT);
    signedLockTxs.push(signedLockTx);
  }

  for (let i = 0; i < BATCH_NUM; i++) {
    const lockTxHash = (await provider.sendTransaction(signedLockTxs[i])).hash;
    lockTxHashes.push(lockTxHash);
  }
  logger.info('lock txs', lockTxHashes);
  return lockTxHashes;
}

async function burn(ckbPriv: string, sender: string, recipient: string): Promise<Array<string>> {
  const burnTxHashes = new Array<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signedBurnTxs = new Array<any>();
  for (let i = 0; i < BATCH_NUM; i++) {
    const burnTx = await generateBurnTx(ETH_TOKEN_ADDRESS, ckbPriv, sender, recipient, BURN_AMOUNT);
    signedBurnTxs.push(burnTx);
  }

  for (let i = 0; i < BATCH_NUM; i++) {
    const burnETHTxHash = await ckb.rpc.sendTransaction(signedBurnTxs[i]);
    burnTxHashes.push(burnETHTxHash);
  }
  logger.info('burn txs', burnTxHashes);
  return burnTxHashes;
}

async function check(txHashes: Array<string>, address: string) {
  for (let i = 0; i < BATCH_NUM; i++) {
    await checkTx(ETH_TOKEN_ADDRESS, txHashes[i], address);
  }
}

async function main() {
  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const conf: Config = nconf.get('forceBridge');
  conf.common.log.logFile = './log/rpc-ci.log';
  initLog(conf.common.log);

  const ckbPublicKey = ckb.utils.privateKeyToPublicKey(CKB_PRI);
  const ckbAddress = ckb.utils.pubkeyToAddress(ckbPublicKey, { prefix: AddressPrefix.Testnet });

  const provider = new ethers.providers.JsonRpcProvider(ETH_NODE_URL);
  const ethWallet = new ethers.Wallet(ETH_PRI, provider);
  const ethAddress = ethWallet.address;

  const lockTxs = await lock(provider, ethWallet, ckbAddress);
  await check(lockTxs, ckbAddress);

  const burnTxs = await burn(CKB_PRI, ckbAddress, ethAddress);
  await check(burnTxs, ckbAddress);
}

main().catch((error) => {
  logger.error(error);
  process.exit(1);
});
