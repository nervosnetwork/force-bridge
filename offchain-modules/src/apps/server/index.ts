import express from 'express';
import bodyParser from 'body-parser';
import 'module-alias/register';
import { JSONRPCServer } from 'json-rpc-2.0';
import nconf from 'nconf';
import { logger } from '@force-bridge/utils/logger';
import { signEthTx } from './eth';
import { collectSignaturesParams } from '@force-bridge/multisig/multisig-mgr';
import { SigServer } from './sigserver';
import { SigServerConfig } from './config';
import { signCkbTx } from './ckbSigner';
import { createConnection } from 'typeorm';
import { SignedDb } from '@force-bridge/db/signed';

const apiPath = '/force-bridge/sign-server/api/v1';

async function main() {
  const args = require('minimist')(process.argv.slice(2));
  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const config: SigServerConfig = nconf.get('forceBridge');

  new SigServer(config);

  const server = new JSONRPCServer();
  const conn = await createConnection();
  const signedDb = new SignedDb(conn);
  server.addMethod('signCkbTx', async (params: collectSignaturesParams) => {
    return await signCkbTx(params);
  });
  server.addMethod('signEthTx', async (payload: collectSignaturesParams) => {
    return await signEthTx(payload, signedDb);
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
