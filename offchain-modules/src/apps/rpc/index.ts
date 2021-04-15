import express from 'express';
import bodyParser from 'body-parser';
import { JSONRPCServer } from 'json-rpc-2.0';
import { rpcConfig } from '@force-bridge/config';
import nconf from 'nconf';
import { logger } from '../../packages/utils/logger';
import { ForceBridgeAPIV1 } from './server';
import { ForceBridgeCore } from '../../packages/core';
import { Config } from '../../packages/config';

const forceBridgePath = '/force-bridge/api/v1';

async function main() {
  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });

  const config: Config = nconf.get('forceBridge');
  const rpcConfig: rpcConfig = nconf.get('forceBridge:rpc');
  await new ForceBridgeCore().init(config);

  const server = new JSONRPCServer();

  const forceBridgeRpc = new ForceBridgeAPIV1();
  // First parameter is a method name.
  // Second parameter is a method itself.
  // A method takes JSON-RPC params and returns a result.
  // It can also return a promise of the result.

  /*
  {
    "jsonrpc": "2.0",
    "method": "echo",
    "params": { "text": "Hello, World!" },
    "id": 1
  }
    =>
  {
    "jsonrpc": "2.0",
    "id": 1,
    "result": "Hello, World!"
  }
  * */
  // @ts-ignore
  server.addMethod('echo', ({ text }) => text); //for test
  server.addMethod('generateBridgeOutNervosTransaction', forceBridgeRpc.generateBridgeOutNervosTransaction);
  server.addMethod('generateBridgeInNervosTransaction', forceBridgeRpc.generateBridgeInNervosTransaction);
  server.addMethod('sendBridgeOutNervosTransaction', forceBridgeRpc.sendBridgeOutNervosTransaction);
  server.addMethod('sendBridgeInNervosTransaction', forceBridgeRpc.sendBridgeInNervosTransaction);

  const app = express();
  app.use(bodyParser.json());

  app.post(forceBridgePath, (req, res) => {
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

  app.listen(rpcConfig.port);
}

main();
