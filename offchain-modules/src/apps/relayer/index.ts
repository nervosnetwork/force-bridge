import { ForceBridgeCore } from '../../packages/core';
import nconf from 'nconf';
import { CkbDb, EthDb } from '../../packages/db';
import { CkbHandler } from '../../packages/handlers/ckb';
import { EthHandler } from '../../packages/handlers/eth';
import { Config } from '../../packages/config';

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
