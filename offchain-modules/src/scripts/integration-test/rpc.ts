import 'module-alias/register';
import { JSONRPCClient } from 'json-rpc-2.0';
import { ethers } from 'ethers';
import fetch from 'node-fetch/index';
import { Config } from '../../packages/config';
import { ForceBridgeCore } from '../../packages/core';
import nconf from 'nconf';
import { asyncSleep } from '@force-bridge/utils';
import { initLog, logger } from '@force-bridge/utils/logger';
import { EthAsset } from '@force-bridge/ckb/model/asset';
import { Script } from '@lay2/pw-core';
import assert from 'assert';

const CKB_PRI_KEY = process.env.PRI_KEY || '0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe';

// JSONRPCClient needs to know how to send a JSON-RPC request.
// Tell it by passing a function to its constructor. The function must take a JSON-RPC request and send it.
const client = new JSONRPCClient((jsonRPCRequest) =>
  fetch('http://localhost:8080/force-bridge/api/v1', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(jsonRPCRequest),
  }).then((response) => {
    if (response.status === 200) {
      // Use client.receive when you received a JSON-RPC response.
      return response.json().then((jsonRPCResponse) => client.receive(jsonRPCResponse));
    } else if (jsonRPCRequest.id !== undefined) {
      return Promise.reject(new Error(response.statusText));
    }
  }),
);

async function lock(ckbLockscript) {
  const lockPayload = {
    sender: '0x0',
    recipient: ckbLockscript,
    asset: {
      network: 'Ethereum',
      ident: '0x0000000000000000000000000000000000000000',
      amount: '1',
    },
  };
  const unsignedLockTx = await client.request('generateBridgeInNervosTransaction', lockPayload);
  logger.info('unsignedMintTx', unsignedLockTx);

  const provider = new ethers.providers.JsonRpcProvider(ForceBridgeCore.config.eth.rpcUrl);
  const wallet = new ethers.Wallet(ForceBridgeCore.config.eth.privateKey, provider);

  const unsignedTx = unsignedLockTx.rawTransaction;
  unsignedTx.value = ethers.BigNumber.from(unsignedTx.value.hex);
  unsignedTx.nonce = await wallet.getTransactionCount();
  unsignedTx.gasLimit = ethers.BigNumber.from(1000000);
  unsignedTx.gasPrice = await provider.getGasPrice();

  logger.info('unsignedTx', unsignedTx);

  const signedTx = await wallet.signTransaction(unsignedTx);
  logger.info('signedTx', signedTx);

  const lockTxHash = (await provider.sendTransaction(signedTx)).hash;
  logger.info('lockTxHash', lockTxHash);
  return lockTxHash;
}

async function getTransaction(ckbAddress) {
  const getTxPayload = {
    network: 'Ethereum',
    userIdent: ckbAddress,
    assetIdent: '0x0000000000000000000000000000000000000000',
  };

  const txs = await client.request('getBridgeTransactionSummaries', getTxPayload);
  logger.info('txs', JSON.stringify(txs));
  return txs;
}

async function burn(ckbLockscript) {
  const burnPayload = {
    network: 'Ethereum',
    sender: ckbLockscript,
    recipient: '0x1000000000000000000000000000000000000001',
    asset: '0x0000000000000000000000000000000000000000',
    amount: '1',
  };
  const unsignedBurnTx = await client.request('generateBridgeOutNervosTransaction', burnPayload);
  logger.info('unsignedBurnTx ', unsignedBurnTx);

  const signedTx = ForceBridgeCore.ckb.signTransaction(CKB_PRI_KEY)(unsignedBurnTx.rawTransaction);
  logger.info('signedTx', signedTx);

  const burnTxHash = await ForceBridgeCore.ckb.rpc.sendTransaction(signedTx);
  logger.info('burnTxHash', burnTxHash);
  return burnTxHash;
}

async function check(ckbAddress, txId) {
  let find = false;
  for (let i = 0; i < 100; i++) {
    await asyncSleep(3000);
    const txs = await getTransaction(ckbAddress);
    for (const tx of txs) {
      if (tx.status == 'Successful' && tx.txSummary.fromTransaction.txId == txId) {
        logger.info(`Tx:${tx}`);
        find = true;
        break;
      }
    }
    if (find) {
      break;
    }
  }
  if (!find) {
    throw new Error(`rpc test failed, can not find record ${txId}`);
  }
}

async function getBalance(ckbAddress) {
  const publicKey = ForceBridgeCore.ckb.utils.privateKeyToPublicKey(CKB_PRI_KEY);

  const { secp256k1Dep } = await ForceBridgeCore.ckb.loadDeps();
  const args = `0x${ForceBridgeCore.ckb.utils.blake160(publicKey, 'hex')}`;
  const lockscript = Script.fromRPC({
    code_hash: secp256k1Dep.codeHash,
    args,
    hash_type: secp256k1Dep.hashType,
  });

  const ownLockHash = ForceBridgeCore.ckb.utils.scriptToHash(<CKBComponents.Script>lockscript);
  const asset = new EthAsset('0x0000000000000000000000000000000000000000', ownLockHash);
  const bridgeCellLockscript = {
    codeHash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
    hashType: ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
    args: asset.toBridgeLockscriptArgs(),
  };
  const sudtArgs = ForceBridgeCore.ckb.utils.scriptToHash(<CKBComponents.Script>bridgeCellLockscript);

  const balancePayload = {
    network: 'Nervos',
    userIdent: ckbAddress,
    assetIdent: sudtArgs,
  };
  const balance = await client.request('getBalance', [balancePayload]);
  logger.info('balance', balance);
  return balance;
}

async function main() {
  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const config: Config = nconf.get('forceBridge');
  // init bridge force core
  await new ForceBridgeCore().init(config);
  config.common.log.logFile = './log/rpc-ci.log';
  initLog(config.common.log);

  const ckbAddress = 'ckt1qyqyph8v9mclls35p6snlaxajeca97tc062sa5gahk';

  const beforeMintBalance = await getBalance(ckbAddress);

  const lockTxHash = await lock(ckbAddress);
  await check(ckbAddress, lockTxHash);

  const afterMintBalance = await getBalance(ckbAddress);
  assert(+beforeMintBalance[0].amount + 1 === +afterMintBalance[0].amount);

  const burnTxHash = await burn(ckbAddress);
  await check(ckbAddress, burnTxHash);

  const afterBurnBalance = await getBalance(ckbAddress);
  assert(+afterBurnBalance[0].amount + 1 === +afterMintBalance[0].amount);
}

main();
