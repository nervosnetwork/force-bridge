import { Config } from '@force-bridge/x/dist/config';
import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { CkbDb, EthDb } from '@force-bridge/x/dist/db';
import { SignedDb } from '@force-bridge/x/dist/db/signed';
import { startHandlers } from '@force-bridge/x/dist/handlers';
import { responseStatus } from '@force-bridge/x/dist/monitor/rpc-metric';
import { SigserverMetric } from '@force-bridge/x/dist/monitor/sigserver-metric';
import { collectSignaturesParams } from '@force-bridge/x/dist/multisig/multisig-mgr';
import { getDBConnection } from '@force-bridge/x/dist/utils';
import { initLog, logger } from '@force-bridge/x/dist/utils/logger';
import { abi } from '@force-bridge/x/dist/xchain/eth/abi/ForceBridge.json';
import bodyParser from 'body-parser';
import { ethers } from 'ethers';
import express from 'express';
import { JSONRPCServer } from 'json-rpc-2.0';
import { Connection } from 'typeorm';
import { signCkbTx } from './ckbSigner';
import { signEthTx } from './ethSigner';
import { loadKeys } from './utils';

const apiPath = '/force-bridge/sign-server/api/v1';
const defaultLogFile = './log/force-bridge-sigsvr.log';

export class SigServer {
  static ethProvider: ethers.providers.JsonRpcProvider;
  static ethInterface: ethers.utils.Interface;
  static ethBridgeContract: ethers.Contract;
  static conn: Connection;
  static signedDb: SignedDb;
  static ckbDb: CkbDb;
  static ethDb: EthDb;
  static keys: Map<string, Map<string, string>>;
  static metrics: SigserverMetric;

  constructor(conn: Connection) {
    SigServer.ethProvider = new ethers.providers.JsonRpcProvider(ForceBridgeCore.config.eth.rpcUrl);
    SigServer.ethInterface = new ethers.utils.Interface(abi);
    SigServer.ethBridgeContract = new ethers.Contract(
      ForceBridgeCore.config.eth.contractAddress,
      abi,
      SigServer.ethProvider,
    );
    SigServer.conn = conn;
    SigServer.signedDb = new SignedDb(conn);
    SigServer.ckbDb = new CkbDb(conn);
    SigServer.ethDb = new EthDb(conn);
    SigServer.keys = new Map<string, Map<string, string>>();

    SigServer.metrics = new SigserverMetric(ForceBridgeCore.config.common.role);

    if (ForceBridgeCore.config.ckb !== undefined) {
      const ckbKeys = new Map<string, string>();
      ForceBridgeCore.config.ckb.multiSignKeys.forEach((key) => {
        ckbKeys[key.address] = key.privKey;
      });
      SigServer.keys['ckb'] = ckbKeys;
    }
    if (ForceBridgeCore.config.eth.multiSignKeys !== undefined) {
      const ethKeys = new Map<string, string>();
      ForceBridgeCore.config.eth.multiSignKeys.forEach((key) => {
        ethKeys[key.address] = key.privKey;
      });
      SigServer.keys['eth'] = ethKeys;
    }
  }

  static getKey(chain: string, address: string): string | undefined {
    const keys = SigServer.keys[chain];
    if (keys === undefined) {
      return;
    }
    return keys[address];
  }
}

export async function startSigServer(config: Config, port: number): Promise<void> {
  if (!config.common.log.logFile) {
    config.common.log.logFile = defaultLogFile;
  }
  initLog(config.common.log);
  config.common.role = 'watcher';
  await new ForceBridgeCore().init(config);
  //load multi-sig keys
  loadKeys();
  const conn = await getDBConnection();
  //start chain handlers
  startHandlers(conn);
  new SigServer(conn);

  const server = new JSONRPCServer();
  server.addMethod('signCkbTx', async (params: collectSignaturesParams) => {
    return await signCkbTx(params);
  });
  server.addMethod('signEthTx', async (payload: collectSignaturesParams) => {
    return await signEthTx(payload);
  });

  const app = express();
  app.use(bodyParser.json());

  app.post(apiPath, (req, res) => {
    logger.info('request', req.method, req.body);
    const startTime = Date.now();
    const jsonRPCRequest = req.body;
    // server.receive takes a JSON-RPC request and returns a promise of a JSON-RPC response.
    // Alternatively, you can use server.receiveJSON, which takes JSON string as is (in this case req.body).
    server.receive(jsonRPCRequest).then(
      (jsonRPCResponse) => {
        if (!jsonRPCResponse) {
          logger.error('Sig Server Error: the jsonRPCResponse is null');
          if (jsonRPCRequest.params && jsonRPCRequest.method && jsonRPCRequest.params.requestAddress) {
            SigServer.metrics.setSigServerRequestMetric(
              jsonRPCRequest.params.requestAddress!,
              jsonRPCRequest.method,
              'failed',
              Date.now() - startTime,
            );
          }
          res.sendStatus(204);
          return;
        }
        const status: responseStatus = jsonRPCResponse.error ? 'failed' : 'success';
        res.json(jsonRPCResponse);
        SigServer.metrics.setSigServerRequestMetric(
          jsonRPCRequest.params.requestAddress!,
          jsonRPCRequest.method,
          status,
          Date.now() - startTime,
        );
        logger.info('response', jsonRPCResponse, ' status :', status);
      },
      (reason) => {
        logger.error('Sig Server Error: the request is rejected by ', reason);
        if (jsonRPCRequest.params && jsonRPCRequest.method && jsonRPCRequest.params.requestAddress) {
          SigServer.metrics.setSigServerRequestMetric(
            jsonRPCRequest.params.requestAddress!,
            jsonRPCRequest.method,
            'failed',
            Date.now() - startTime,
          );
        }
        res.sendStatus(500);
      },
    );
  });
  app.listen(port);
  logger.info(`sig server handler started on ${port}  🚀`);
}
