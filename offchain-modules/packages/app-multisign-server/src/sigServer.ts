import { bootstrap, ForceBridgeCore } from '@force-bridge/x/dist/core';
import { CkbDb, EthDb, KVDb } from '@force-bridge/x/dist/db';
import { SignedDb } from '@force-bridge/x/dist/db/signed';
import { startHandlers } from '@force-bridge/x/dist/handlers';
import { responseStatus } from '@force-bridge/x/dist/metric/rpc-metric';
import { SigserverMetric } from '@force-bridge/x/dist/metric/sigserver-metric';
import { collectSignaturesParams, getPendingTxParams } from '@force-bridge/x/dist/multisig/multisig-mgr';
import { ServerSingleton } from '@force-bridge/x/dist/server/serverSingleton';
import { getDBConnection, privateKeyToCkbAddress, privateKeyToEthAddress } from '@force-bridge/x/dist/utils';
import { logger } from '@force-bridge/x/dist/utils/logger';
import { abi } from '@force-bridge/x/dist/xchain/eth/abi/ForceBridge.json';
import bodyParser from 'body-parser';
import { ethers } from 'ethers';
import { JSONRPCServer } from 'json-rpc-2.0';
import * as snappy from 'snappy';
import { Connection } from 'typeorm';
import { signCkbTx } from './ckbSigner';
import { SigError, SigErrorCode } from './error';
import { signEthTx } from './ethSigner';
import { getPendingTx, getPendingTxResult } from './pendingTx';
import { serverStatus, serverStatusResult } from './status';

const apiPath = '/force-bridge/sign-server/api/v1';

const ethPendingTxKey = 'ethPendingTx';
const ckbPendingTxKey = 'ckbPendingTx';

export type SigResponseData = string | serverStatusResult | getPendingTxResult;

export class SigResponse {
  Data?: SigResponseData;
  Error: SigError;

  constructor(err: SigError, data?: SigResponseData) {
    this.Error = err;
    if (data) {
      this.Data = data;
    }
  }

  static fromSigError(code: SigErrorCode, message?: string): SigResponse {
    return new SigResponse(new SigError(code, message));
  }
  static fromData(data: SigResponseData): SigResponse {
    return new SigResponse(new SigError(SigErrorCode.Ok), data);
  }
}

export class SigServer {
  static ethProvider: ethers.providers.JsonRpcProvider;
  static ethInterface: ethers.utils.Interface;
  static ethBridgeContract: ethers.Contract;
  static conn: Connection;
  static signedDb: SignedDb;
  static ckbDb: CkbDb;
  static ethDb: EthDb;
  static kvDb: KVDb;
  static keys: Map<string, Map<string, string>>;
  static pendingTxs: Map<string, getPendingTxResult>;
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
    SigServer.kvDb = new KVDb(conn);
    SigServer.keys = new Map<string, Map<string, string>>();
    SigServer.pendingTxs = new Map<string, getPendingTxResult>();
    SigServer.metrics = new SigserverMetric(ForceBridgeCore.config.common.role);

    if (ForceBridgeCore.config.ckb !== undefined) {
      const ckbKeys = new Map<string, string>();
      const ckbPrivateKey = ForceBridgeCore.config.ckb.privateKey;
      const ckbAddress = privateKeyToCkbAddress(ckbPrivateKey);
      ckbKeys[ckbAddress] = ckbPrivateKey;
      SigServer.keys['ckb'] = ckbKeys;
    }
    if (ForceBridgeCore.config.eth !== undefined) {
      const ethKeys = new Map<string, string>();
      const ethPrivateKey = ForceBridgeCore.config.eth.privateKey;
      const ethAddress = privateKeyToEthAddress(ethPrivateKey);
      ethKeys[ethAddress] = ethPrivateKey;
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

  static async getPendingTx(chain: string): Promise<getPendingTxResult> {
    let pendingTxKey = '';
    switch (chain) {
      case 'ckb':
        pendingTxKey = ckbPendingTxKey;
        break;
      case 'eth':
        pendingTxKey = ethPendingTxKey;
        break;
      default:
        throw new Error(`invalid chain type:${chain}`);
    }

    let pendingTx = SigServer.pendingTxs.get(pendingTxKey);
    if (pendingTx) {
      return pendingTx;
    }
    const data = await SigServer.kvDb.get(pendingTxKey);
    if (!data) {
      return undefined;
    }
    const uncompressed = snappy.uncompressSync(Buffer.from(data as string, 'base64'), { asBuffer: false });
    pendingTx = JSON.parse(uncompressed as string);
    SigServer.pendingTxs.set(pendingTxKey, pendingTx);
    return pendingTx;
  }

  static async setPendingTx(chain: string, pendingTx: getPendingTxResult): Promise<void> {
    let pendingTxKey = '';
    switch (chain) {
      case 'ckb':
        pendingTxKey = ckbPendingTxKey;
        break;
      case 'eth':
        pendingTxKey = ethPendingTxKey;
        break;
      default:
        throw new Error(`invalid chain type:${chain}`);
    }
    SigServer.pendingTxs.set(pendingTxKey, pendingTx);
    const compressed = snappy.compressSync(JSON.stringify(pendingTx));
    await SigServer.kvDb.set(pendingTxKey, compressed.toString('base64'));
  }
}

export async function startSigServer(configPath: string): Promise<void> {
  await bootstrap(configPath);
  ForceBridgeCore.config.common.role = 'watcher';
  const conn = await getDBConnection();
  //start chain handlers
  startHandlers(conn);
  new SigServer(conn);

  const server = new JSONRPCServer();
  server.addMethod('signCkbTx', async (params: collectSignaturesParams) => {
    try {
      return await signCkbTx(params);
    } catch (e) {
      logger.error(`signCkbTx params:${JSON.stringify(params)} error:${e.stack}`);
      return SigResponse.fromSigError(SigErrorCode.UnknownError, e.message);
    }
  });
  server.addMethod('signEthTx', async (params: collectSignaturesParams) => {
    try {
      return await signEthTx(params);
    } catch (e) {
      logger.error(`signEthTx params:${JSON.stringify(params)} error:${e.stack}`);
      return SigResponse.fromSigError(SigErrorCode.UnknownError, e.message);
    }
  });
  server.addMethod('status', async () => {
    try {
      return await serverStatus();
    } catch (e) {
      logger.error(`status error:${e.message}`);
      return SigResponse.fromSigError(SigErrorCode.UnknownError, e.message);
    }
  });
  server.addMethod('pendingTx', async (params: getPendingTxParams) => {
    try {
      return await getPendingTx(params);
    } catch (e) {
      logger.error(`get getPendingTx params:${JSON.stringify(params, undefined, 2)} error:${e.message}`);
      return SigResponse.fromSigError(SigErrorCode.UnknownError, e.message);
    }
  });

  ServerSingleton.getInstance().getServer().use(bodyParser.json());

  ServerSingleton.getInstance()
    .getServer()
    .post(apiPath, (req, res) => {
      logger.info(`request method ${req.method}, body ${JSON.stringify(req.body)}`);
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

          let status: responseStatus = 'failed';
          if (!jsonRPCResponse.error) {
            const sigRsp = jsonRPCResponse.result as SigResponse;
            if (sigRsp.Error.Code === SigErrorCode.Ok) {
              jsonRPCResponse.result = sigRsp.Data;
              status = 'success';
            } else {
              jsonRPCResponse.result = undefined;
              jsonRPCResponse.error = { code: sigRsp.Error.Code, message: sigRsp.Error.Message };
            }
          }

          res.json(jsonRPCResponse);
          if (jsonRPCRequest.params && jsonRPCRequest.method && jsonRPCRequest.params.requestAddress) {
            SigServer.metrics.setSigServerRequestMetric(
              jsonRPCRequest.params.requestAddress!,
              jsonRPCRequest.method,
              status,
              Date.now() - startTime,
            );
          }
          logger.info(`response: ${JSON.stringify(jsonRPCResponse)}, status: ${status}`);
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
}
