import { bootstrap } from '@force-bridge/x/dist/core';
import { getFromEnv } from '@force-bridge/x/dist/utils';
import { createCKBRecordObservable, createETHRecordObservable } from '@force-bridge/xchain-eth/dist/reconc';
import { Monitor } from './monitor';

async function main() {
  //watcher config path
  const configPath = getFromEnv('CONFIG_PATH');
  await bootstrap(configPath);

  const monitor = new Monitor(createETHRecordObservable(), createCKBRecordObservable());
  await monitor.start();
}

void main();
