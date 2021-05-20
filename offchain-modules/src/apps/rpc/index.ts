import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import 'module-alias/register';
import { JSONRPCServer } from 'json-rpc-2.0';
import { rpcConfig } from '@force-bridge/config';
import nconf from 'nconf';
import { logger, initLog } from '@force-bridge/utils/logger';
import { ForceBridgeAPIV1Handler } from './handler';
import { ForceBridgeCore } from '@force-bridge/core';
import { Config } from '@force-bridge/config';
import { createConnection } from 'typeorm';
import { GetBalancePayload, GetBridgeTransactionSummariesPayload, XChainNetWork } from './types/apiv1';

const forceBridgePath = '/force-bridge/api/v1';
const defaultLogFile = './log/force-bridge-rpc.log';

async function main() {
  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });

  const config: Config = nconf.get('forceBridge');
  const rpcConfig: rpcConfig = nconf.get('forceBridge:rpc');
  await new ForceBridgeCore().init(config);
  if (!config.common.log.logFile) {
    config.common.log.logFile = defaultLogFile;
  }
  initLog(ForceBridgeCore.config.common.log);

  const server = new JSONRPCServer();

  const conn = await createConnection();
  const forceBridgeRpc = new ForceBridgeAPIV1Handler(conn);
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
  server.addMethod('sendSignedTransaction', forceBridgeRpc.sendSignedTransaction);
  server.addMethod(
    'getBridgeTransactionSummaries',
    async (payload: GetBridgeTransactionSummariesPayload<XChainNetWork>) => {
      return await forceBridgeRpc.getBridgeTransactionSummaries(payload);
    },
  );
  server.addMethod('getBalance', async (payload: GetBalancePayload) => {
    return await forceBridgeRpc.getBalance(payload);
  });
  server.addMethod('getAssetList', async (payload) => {
    return await forceBridgeRpc.getAssetList(payload);
  });
  const app = express();
  app.use(bodyParser.json());

  app.post(forceBridgePath, cors(config.rpc.corsOptions), (req, res) => {
    logger.info('request', req.method, req.body);
    const jsonRPCRequest = req.body;
    // server.receive takes a JSON-RPC request and returns a promise of a JSON-RPC response.
    // Alternatively, you can use server.receiveJSON, which takes JSON string as is (in this case req.body).
    server.receive(jsonRPCRequest).then((jsonRPCResponse) => {
      if (jsonRPCResponse) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
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
  logger.debug(`rpc server handler started on ${rpcConfig.port}  🚀`);
}

main();
