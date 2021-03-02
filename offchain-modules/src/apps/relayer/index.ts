import 'module-alias/register';
import nconf from 'nconf';
import { ForceBridgeCore } from '@force-bridge/core';
import { CkbDb, EthDb } from '@force-bridge/db';
import { CkbHandler } from '@force-bridge/handlers/ckb';
import { EthHandler } from '@force-bridge/handlers/eth';
import { Config } from '@force-bridge/config';

async function main() {
  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const config: Config = nconf.get('forceBridge');
  // init bridge force core
  const core = await new ForceBridgeCore().init(config);

  // init db and start handlers
  const ckbDb = new CkbDb();
  const ckbHandler = new CkbHandler(ckbDb);
  ckbHandler.start();

  // start xchain handlers if config exists
  if (config.eth !== undefined) {
    const ethDb = new EthDb();
    const ethHandler = new EthHandler(ethDb);
    ethHandler.start();
  }
}

main();
