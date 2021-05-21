import 'reflect-metadata';
import { Config } from '@force-bridge/x/dist/config';
import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { startHandlers } from '@force-bridge/x/dist/handlers';
import { initLog } from '@force-bridge/x/dist/utils/logger';
import nconf from 'nconf';

const defaultLogFile = './log/force-bridge-relay.log';

async function main() {
  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const config: Config = nconf.get('forceBridge');
  if (!config.common.log.logFile) {
    config.common.log.logFile = defaultLogFile;
  }

  // init log
  initLog(config.common.log);
  // init bridge force core
  await new ForceBridgeCore().init(config);
  //start chain handlers
  await startHandlers();
}

main();
