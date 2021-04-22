import 'module-alias/register';
import { JSONRPCClient } from 'json-rpc-2.0';
import { ethers } from 'ethers';
import fetch from 'node-fetch/index';
import { Config } from '../../packages/config';
import { ForceBridgeCore } from '../../packages/core';
import nconf from 'nconf';

import { abi } from '@force-bridge/xchain/eth/abi/ForceBridge.json';
import { asyncSleep, stringToUint8Array, toHexString } from '@force-bridge/utils';

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
      ident: {
        address: '0x0000000000000000000000000000000000000000',
      },
      amount: '1',
    },
  };
  const unsignedMintTx = await client.request('generateBridgeInNervosTransaction', mintPayload);
  console.log('unsignedMintTx', unsignedMintTx);

  const provider = new ethers.providers.JsonRpcProvider(ForceBridgeCore.config.eth.rpcUrl);
  const wallet = new ethers.Wallet(ForceBridgeCore.config.eth.privateKey, provider);

  const unsignedTx = unsignedMintTx.rawTransaction;
  unsignedTx.value = ethers.BigNumber.from(unsignedTx.value.hex);
  unsignedTx.nonce = await wallet.getTransactionCount();
  unsignedTx.gasLimit = ethers.BigNumber.from(1000000);
  unsignedTx.gasPrice = await provider.getGasPrice();

  console.log('unsignedTx', unsignedTx);

  //   const bridgeContractAddr = ForceBridgeCore.config.eth.contractAddress;
  //   const bridge = new ethers.Contract(bridgeContractAddr, abi, provider);

  //   const recipient = stringToUint8Array('ckt1qyqyph8v9mclls35p6snlaxajeca97tc062sa5gahk');
  //   const ethAmount = ethers.utils.parseUnits('1', 0);
  //   const testTx = await bridge.populateTransaction.lockETH(recipient, '0x', { value: ethAmount });

  //   console.log('testTx', testTx);
  const signedTx = await wallet.signTransaction(unsignedTx);
  console.log('signedTx', signedTx);

  const sendPayload = {
    network: 'Ethereum',
    signedTransaction: signedTx,
  };
  const mintTxHash = await client.request('sendSignedTransaction', sendPayload);
  console.log('mintTxHash', mintTxHash);
}

async function burn(ckbLockscript) {
  const burnPayload = {
    network: 'Ethereum',
    sender: ckbLockscript,
    recipient: {
      address: '0x1000000000000000000000000000000000000001',
    },
    asset: {
      amount: '1',
      ident: {
        address: '0x0000000000000000000000000000000000000000',
      },
    },
  };
  const unsignedBurnTx = await client.request('generateBridgeOutNervosTransaction', burnPayload);
  console.log('unsignedBurnTx ', unsignedBurnTx);

  const signedTx = ForceBridgeCore.ckb.signTransaction(CKB_PRI_KEY)(unsignedBurnTx.rawTransaction);
  console.log('signedTx', signedTx);

  const sendPayload = {
    network: 'Nervos',
    signedTransaction: JSON.stringify(signedTx),
  };
  const burnTxHash = await client.request('sendSignedTransaction', sendPayload);
  console.log('burnTxHash', burnTxHash);
}

async function main() {
  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const config: Config = nconf.get('forceBridge');
  // init bridge force core
  await new ForceBridgeCore().init(config);

  const publicKey = ForceBridgeCore.ckb.utils.privateKeyToPublicKey(CKB_PRI_KEY);
  const { secp256k1Dep } = await ForceBridgeCore.ckb.loadDeps();
  const args = `0x${ForceBridgeCore.ckb.utils.blake160(publicKey, 'hex')}`;

  const ckbLockscript = {
    codeHash: secp256k1Dep.codeHash,
    args: args,
    hashType: secp256k1Dep.hashType,
  };

  //await mint(ckbLockscript);

  await burn(ckbLockscript);
}

main();
