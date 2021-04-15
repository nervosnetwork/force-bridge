import 'reflect-metadata';
import 'module-alias/register';
import express from 'express';
import bodyParser from 'body-parser';
import { JSONRPCServer } from 'json-rpc-2.0';
import { Config } from '@force-bridge/config';
import nconf from 'nconf';
import { logger } from '../../packages/utils/logger';
import { getBalance, getLockRecord, getUnlockRecord } from './query';
import { ForceBridgeCore } from '@force-bridge/core';
import { createConnection } from 'typeorm';

const forceBridgePath = '/force-bridge/api/v1';

async function main() {
  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const config: Config = nconf.get('forceBridge');
  // init bridge force core
  await new ForceBridgeCore().init(config);
  const server = new JSONRPCServer();
  const conn = await createConnection();

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

  // @ts-ignore
  server.addMethod('getBalance', async ({ chainType, ckbAddress, tokenAddress }) => {
    return await getBalance(chainType, ckbAddress, tokenAddress);
  });

  // @ts-ignore
  server.addMethod('getLockRecord', async ({ chainType, userAddress }) => {
    return await getLockRecord(conn, userAddress, chainType);
  });

  // @ts-ignore
  server.addMethod('getUnlockRecord', async ({ chainType, ckbAddress }) => {
    return await getUnlockRecord(conn, ckbAddress, chainType);
  });

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
  logger.info('rpc server started  🚀');
  app.listen(config.rpc.port);
}

main();
