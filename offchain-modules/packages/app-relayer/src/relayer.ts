import 'reflect-metadata';
import { Config } from '@force-bridge/x/dist/config';
import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { startHandlers } from '@force-bridge/x/dist/handlers';
import { getDBConnection } from '@force-bridge/x/dist/utils';
import { initLog } from '@force-bridge/x/dist/utils/logger';

const defaultLogFile = './log/force-bridge-relay.log';

export async function startRelayer(config: Config) {
  if (!config.common.log.logFile) {
    config.common.log.logFile = defaultLogFile;
  }
  // init log
  initLog(config.common.log);
  // init bridge force core
  await new ForceBridgeCore().init(config);
  const conn = await getDBConnection();
  //start chain handlers
  await startHandlers(conn);
}
