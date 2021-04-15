import { JSONRPCClient } from 'json-rpc-2.0';
import { ethers } from 'ethers';
import fetch from 'node-fetch/index';
import { Config } from '../../packages/config';
import { ForceBridgeCore } from '../../packages/core';
import nconf from 'nconf';
import { sign } from '@force-bridge/ckb/tx-helper/signer';

const TronWeb = require('tronweb');

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
  const tronWeb = new TronWeb({
    fullHost: ForceBridgeCore.config.tron.tronGridUrl,
  });
  const userPrivateKey = 'AECC2FBC0BF175DDD04BD1BC3B64A13DB98738962A512544C89B50F5DDB7EBBD';
  const from = tronWeb.address.fromPrivateKey(userPrivateKey);

  const mintPayload = {
    sender: from,
    recipient: ckbLockscript,
    asset: {
      ident: {
        network: 'Tron',
        address: 'trx',
      },
      amount: '1',
    },
  };
  const unsignedMintTx = await client.request('generateBridgeInNervosTransaction', mintPayload);
  console.log('unsignedMintTx', unsignedMintTx);

  const signedTx = await tronWeb.trx.sign(JSON.parse(unsignedMintTx.rawTransaction), userPrivateKey);
  console.log('signedTx', signedTx);

  const sendPayload = {
    network: 'Tron',
    signedTransaction: JSON.stringify(signedTx),
  };
  const mintTxHash = await client.request('sendBridgeInNervosTransaction', sendPayload);
  console.log('mintTxHash', mintTxHash);
}

async function burn(ckbLockscript) {
  const burnPayload = {
    sender: ckbLockscript,
    recipient: 'TS6VejPL8cQy6pA8eDGyusmmhCrXHRdJK6',
    asset: {
      amount: '1',
      ident: {
        network: 'Tron',
        address: 'trx',
      },
    },
  };
  const unsignedBurnTx = await client.request('generateBridgeOutNervosTransaction', burnPayload);
  console.log('unsignedBurnTx ', unsignedBurnTx);

  const signedTx = ForceBridgeCore.ckb.signTransaction(CKB_PRI_KEY)(JSON.parse(unsignedBurnTx.rawTransaction));
  console.log('signedTx', signedTx);

  const sendPayload = {
    signedTransaction: JSON.stringify(signedTx),
  };
  const burnTxHash = await client.request('sendBridgeOutNervosTransaction', sendPayload);
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

  await mint(ckbLockscript);

  //await burn(ckbLockscript);
}

main();
