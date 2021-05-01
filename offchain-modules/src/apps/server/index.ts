import express from 'express';
import bodyParser from 'body-parser';
import 'module-alias/register';
import { JSONRPCServer } from 'json-rpc-2.0';
import { Config, rpcConfig } from '@force-bridge/config';
import nconf from 'nconf';
import { logger } from '@force-bridge/utils/logger';
import { ForceBridgeCore } from '@force-bridge/core';
import { TransactionSkeletonType } from '@ckb-lumos/helpers';
import { key } from '@ckb-lumos/hd';
import { ethers } from 'ethers';
const { ecsign, toRpcSig } = require('ethereumjs-util');

const apiPath = '/force-bridge/sign-server/api/v1';

// enum ChainType {
//   BTC,
//   ETH,
//   EOS,
//   TRON,
//   CKB = 99,
// }

// type SignPayload = {
//   chainType: ChainType;
//   rawTx: TransactionSkeletonType;
// };

// async function sign(payload: SignPayload) {
//   console.log('payload:', JSON.stringify(payload, null, 2));
//   switch (payload.chainType) {
//     case ChainType.CKB:
//       return await signCkbTx(payload.rawTx);
//     case ChainType.ETH:
//       return await signEthTx();
//     default:
//       throw new Error('chain type not supported!');
//   }
// }

async function verifyCkbTx(_txSkeleton: TransactionSkeletonType): Promise<boolean> {
  return true;
}
async function signCkbTx(txSkeleton: TransactionSkeletonType): Promise<string> {
  if (!(await verifyCkbTx(txSkeleton))) {
    throw new Error('the rawtx is invalid!');
  }
  const args = require('minimist')(process.argv.slice(2));
  const index = args.index;
  const privKey = ForceBridgeCore.config.ckb.keys[index];
  const message = txSkeleton.signingEntries[1].message;
  return key.signRecoverable(message, privKey).slice(2);
}

async function signEthTx(payload): Promise<string> {
  //FIXME: verify eth_tx payload.
  const provider = new ethers.providers.JsonRpcProvider(ForceBridgeCore.config.eth.rpcUrl);
  logger.debug('signEthTx msg: ', payload);
  const args = require('minimist')(process.argv.slice(2));
  const index = args.index;
  const privKey = ForceBridgeCore.config.eth.multiSignKeys[index];
  const wallet = new ethers.Wallet(privKey, provider);
  const { v, r, s } = ecsign(Buffer.from(payload.msg.slice(2), 'hex'), Buffer.from(wallet.privateKey.slice(2), 'hex'));
  const sigHex = toRpcSig(v, r, s);
  return sigHex.slice(2);
}

async function main() {
  const args = require('minimist')(process.argv.slice(2));
  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });

  const config: Config = nconf.get('forceBridge');
  await new ForceBridgeCore().init(config);

  const server = new JSONRPCServer();

  server.addMethod('signCkbTx', async (payload: TransactionSkeletonType) => {
    return await signCkbTx(payload);
  });
  server.addMethod('signEthTx', async (payload) => {
    return await signEthTx(payload);
  });

  const app = express();
  app.use(bodyParser.json());

  app.post(apiPath, (req, res) => {
    logger.info('request', req.method, req.body);
    const jsonRPCRequest = req.body;
    // server.receive takes a JSON-RPC request and returns a promise of a JSON-RPC response.
    // Alternatively, you can use server.receiveJSON, which takes JSON string as is (in this case req.body).
    server.receive(jsonRPCRequest).then((jsonRPCResponse) => {
      if (jsonRPCResponse) {
        res.json(jsonRPCResponse);
        logger.info('response', jsonRPCResponse);
      } else {
        // If response is absent, it was a JSON-RPC notification method.
        // Respond with no content status (204).
        logger.error('response', 204);
        res.sendStatus(204);
      }
    });
  });
  let port = 8080;
  if (args.port != undefined) {
    port = args.port;
  }
  app.listen(port);
  logger.debug(`rpc server handler started on ${port}  🚀`);
}

main();
