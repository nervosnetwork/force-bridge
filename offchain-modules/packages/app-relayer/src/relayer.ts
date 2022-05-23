import 'reflect-metadata';
import { bootstrap, ForceBridgeCore } from '@force-bridge/x/dist/core';
import { startHandlers } from '@force-bridge/x/dist/handlers';
import { responseStatus, RpcMetric } from '@force-bridge/x/dist/metric/rpc-metric';
import { ServerSingleton } from '@force-bridge/x/dist/server/serverSingleton';
import { getDBConnection } from '@force-bridge/x/dist/utils';
import { logger } from '@force-bridge/x/dist/utils/logger';
import bodyParser from 'body-parser';
import { JSONRPCServer } from 'json-rpc-2.0';
import { ForceBridgeCollectorHandler } from './handler';

const forceBridgePath = '/force-bridge/api/v1';

export async function startRelayer(configPath: string) {
  await bootstrap(configPath);
  const conn = await getDBConnection();
  //start chain handlers
  await startHandlers(conn);

  const metrics = new RpcMetric(ForceBridgeCore.config.common.role);
  // start collector rpc
  const forceBridgeCollectorRpc = new ForceBridgeCollectorHandler();

  const server = new JSONRPCServer();
  server.addMethod('switchGasPriceGweiAuto', forceBridgeCollectorRpc.switchGasPriceGweiAuto);

  ServerSingleton.getInstance().getServer().use(bodyParser.json());

  ServerSingleton.getInstance()
    .getServer()
    .post(forceBridgePath, (req, res) => {
      logger.info(`request, method: ${req.method}, body: ${JSON.stringify(req.body)}`);
      const jsonRPCRequest = req.body;
      const startTime = Date.now();
      // server.receive takes a JSON-RPC request and returns a promise of a JSON-RPC response.
      // Alternatively, you can use server.receiveJSON, which takes JSON string as is (in this case req.body).
      void server.receive(jsonRPCRequest).then(
        (jsonRPCResponse) => {
          if (!jsonRPCResponse) {
            logger.error('RPC Server Error: the jsonRPCResponse is null');
            if (jsonRPCRequest.method) {
              metrics.setRpcRequestMetric(jsonRPCRequest.method, 'failed', Date.now() - startTime);
            }
            res.sendStatus(204);
            return;
          }
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.json(jsonRPCResponse);
          const status: responseStatus = jsonRPCResponse.error ? 'failed' : 'success';
          metrics.setRpcRequestMetric(jsonRPCRequest.method, status, Date.now() - startTime);
          logger.info(`response: ${JSON.stringify(jsonRPCResponse)}, status: ${status}`);
        },
        (reason) => {
          logger.error('RPC Server Error: the request is rejected by ', reason);
          if (jsonRPCRequest.method) {
            metrics.setRpcRequestMetric(jsonRPCRequest.method, 'failed', Date.now() - startTime);
          }
          res.sendStatus(500);
        },
      );
    });
}
