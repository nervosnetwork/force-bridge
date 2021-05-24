import { Config } from '@force-bridge/x/dist/config';
import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { SignedDb } from '@force-bridge/x/dist/db/signed';
import { startHandlers } from '@force-bridge/x/dist/handlers';
import { collectSignaturesParams } from '@force-bridge/x/dist/multisig/multisig-mgr';
import { logger } from '@force-bridge/x/dist/utils/logger';
import bodyParser from 'body-parser';
import express from 'express';
import { JSONRPCServer } from 'json-rpc-2.0';
import minimist from 'minimist';
import nconf from 'nconf';
import { createConnection } from 'typeorm';
import { signCkbTx } from './ckbSigner';
import { signEthTx } from './ethSigner';
import { SigServer } from './sigServer';
const apiPath = '/force-bridge/sign-server/api/v1';

async function main() {
  const args = minimist(process.argv.slice(2));
  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const cfg: Config = nconf.get('forceBridge');
  await new ForceBridgeCore().init(cfg);
  const conn = await createConnection();
  const signDb = new SignedDb(conn);
  //start chain handlers
  startHandlers();
  new SigServer(signDb);

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
