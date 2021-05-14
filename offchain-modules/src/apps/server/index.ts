import express from 'express';
import bodyParser from 'body-parser';
import 'module-alias/register';
import { JSONRPCServer } from 'json-rpc-2.0';
import { Config } from '@force-bridge/config';
import nconf from 'nconf';
import { logger } from '@force-bridge/utils/logger';
import { ForceBridgeCore } from '@force-bridge/core';
import { signEthTx } from './eth';
import { signCkbTx, init } from './ckb';
import { collectSignaturesParams } from '@force-bridge/multisig/multisig-mgr';

const apiPath = '/force-bridge/sign-server/api/v1';

async function main() {
  const args = require('minimist')(process.argv.slice(2));
  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });

  const config: Config = nconf.get('forceBridge');
  await new ForceBridgeCore().init(config);

  init({
    eth: {
      rpcUrl: config.eth.rpcUrl,
      contractAddress: config.eth.contractAddress,
    },
    ckb: {
      multisigScript: config.ckb.multisigScript,
      multisigType: config.ckb.multisigType,
      deps: {
        bridgeLock: config.ckb.deps.bridgeLock,
        recipientType: config.ckb.deps.recipientType,
        sudtType: config.ckb.deps.sudtType,
      },
    },
  });

  const server = new JSONRPCServer();

  server.addMethod('signCkbTx', async (params: collectSignaturesParams) => {
    return await signCkbTx(params);
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
