import 'reflect-metadata';
import { bootstrap } from '@force-bridge/x/dist/core';
import { startHandlers } from '@force-bridge/x/dist/handlers';
import { getDBConnection } from '@force-bridge/x/dist/utils';

export async function startRelayer(configPath: string) {
  await bootstrap(configPath);
  const conn = await getDBConnection();
  //start chain handlers
  await startHandlers(conn);
}
