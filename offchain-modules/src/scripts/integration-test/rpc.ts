import 'module-alias/register';
import { JSONRPCClient } from 'json-rpc-2.0';
import { ethers } from 'ethers';
import fetch from 'node-fetch/index';
import { Config } from '@force-bridge/config';
import { ForceBridgeCore } from '@force-bridge/core';
import nconf from 'nconf';
import { asyncSleep } from '@force-bridge/utils';
import { initLog, logger } from '@force-bridge/utils/logger';

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

async function mint(ckbLockscript) {
  const mintPayload = {
    sender: '0x0',
    recipient: ckbLockscript,
    asset: {
      network: 'Ethereum',
      ident: '0x0000000000000000000000000000000000000000',
      amount: '1',
    },
  };
  const unsignedMintTx = await client.request('generateBridgeInNervosTransaction', mintPayload);
  logger.info('unsignedMintTx', unsignedMintTx);

  const provider = new ethers.providers.JsonRpcProvider(ForceBridgeCore.config.eth.rpcUrl);
  const wallet = new ethers.Wallet(ForceBridgeCore.config.eth.privateKey, provider);

  const unsignedTx = unsignedMintTx.rawTransaction;
  unsignedTx.value = ethers.BigNumber.from(unsignedTx.value.hex);
  unsignedTx.nonce = await wallet.getTransactionCount();
  unsignedTx.gasLimit = ethers.BigNumber.from(1000000);
  unsignedTx.gasPrice = await provider.getGasPrice();

  logger.info('unsignedTx', unsignedTx);

  const signedTx = await wallet.signTransaction(unsignedTx);
  logger.info('signedTx', signedTx);

  const mintTxHash = (await provider.sendTransaction(signedTx)).hash;
  logger.info('mintTxHash', mintTxHash);
  return mintTxHash;
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
      if ((tx.status = 'Successful' && tx.txSummary.fromTransaction.txId == txId)) {
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

async function main() {
  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const config: Config = nconf.get('forceBridge');
  // init bridge force core
  await new ForceBridgeCore().init(config);
  config.common.log.logFile = './log/rpc-ci.log';
  initLog(config.common.log);

  const ckbAddress = 'ckt1qyqyph8v9mclls35p6snlaxajeca97tc062sa5gahk';

  const mintTxHash = await mint(ckbAddress);
  await check(ckbAddress, mintTxHash);

  const burnTxHash = await burn(ckbAddress);
  await check(ckbAddress, burnTxHash);
}

main();
