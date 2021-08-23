import { bootstrap, ForceBridgeCore } from '@force-bridge/x/dist/core';
import { startHandlers } from '@force-bridge/x/dist/handlers';
import { responseStatus, RpcMetric } from '@force-bridge/x/dist/metric/rpc-metric';
import { ServerSingleton } from '@force-bridge/x/dist/server/serverSingleton';
import { getDBConnection } from '@force-bridge/x/dist/utils';
import { logger } from '@force-bridge/x/dist/utils/logger';
import bodyParser from 'body-parser';
import { JSONRPCServer } from 'json-rpc-2.0';
import { ForceBridgeAPIV1Handler } from './handler';
import { GetBalancePayload, GetBridgeTransactionSummariesPayload, XChainNetWork } from './types/apiv1';

const version = '0.0.6';
const forceBridgePath = '/force-bridge/api/v1';

export async function startRpcServer(configPath: string): Promise<void> {
  await bootstrap(configPath);
  ForceBridgeCore.config.common.role = 'watcher';
  const metrics = new RpcMetric(ForceBridgeCore.config.common.role);
  const conn = await getDBConnection();
  //start chain handlers
  void startHandlers(conn);
  const forceBridgeRpc = new ForceBridgeAPIV1Handler(conn);

  const server = new JSONRPCServer();
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
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  server.addMethod('version', () => {
    return version;
  });
  server.addMethod('generateBridgeOutNervosTransaction', forceBridgeRpc.generateBridgeOutNervosTransaction);
  server.addMethod('generateBridgeInNervosTransaction', forceBridgeRpc.generateBridgeInNervosTransaction);
  server.addMethod('sendSignedTransaction', forceBridgeRpc.sendSignedTransaction);
  server.addMethod('getBridgeInNervosBridgeFee', forceBridgeRpc.getBridgeInNervosBridgeFee);
  server.addMethod('getBridgeOutNervosBridgeFee', forceBridgeRpc.getBridgeOutNervosBridgeFee);
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
  server.addMethod('getBridgeConfig', () => forceBridgeRpc.getBridgeConfig());

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
