import { Asset } from '@force-bridge/x/dist/ckb/model/asset';
import { IndexerCollector } from '@force-bridge/x/dist/ckb/tx-helper/collector';
import { Config } from '@force-bridge/x/dist/config';
import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { asyncSleep } from '@force-bridge/x/dist/utils';
import { initLog } from '@force-bridge/x/dist/utils/logger';
import { Amount, HashType, Script } from '@lay2/pw-core';
import nconf from 'nconf';

const defaultLogFile = './log/force-bridge-cli.log';

export async function initConfig() {
  const configPath = process.env.CONFIG_PATH || './config-cli.json';
  nconf.env().file({ file: configPath });
  const config: Config = nconf.get('forceBridge');
  await new ForceBridgeCore().init(config);
  if (!config.common.log.logFile) {
    config.common.log.logFile = defaultLogFile;
  }
  initLog(ForceBridgeCore.config.common.log);
}

export function parseOptions(args: any, command: any): Map<string, string> {
  const values = command.args;
  const optionMap = new Map();
  const options = Object.keys(args);
  for (const i in options) {
    optionMap.set(options[i], values[i]);
  }
  return optionMap;
}

export async function getSudtBalance(address: string, asset: Asset): Promise<Amount> {
  const bridgeCellLockscript = {
    codeHash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
    hashType: ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
    args: asset.toBridgeLockscriptArgs(),
  };
  const sudtArgs = ForceBridgeCore.ckb.utils.scriptToHash(<CKBComponents.Script>bridgeCellLockscript);
  const sudtType = {
    codeHash: ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash,
    hashType: ForceBridgeCore.config.ckb.deps.sudtType.script.hashType,
    args: sudtArgs,
  };

  const userScript = ForceBridgeCore.ckb.utils.addressToScript(address);
  const collector = new IndexerCollector(ForceBridgeCore.indexer);
  return await collector.getSUDTBalance(
    new Script(sudtType.codeHash, sudtType.args, sudtType.hashType),
    new Script(userScript.codeHash, userScript.args, userScript.hashType as HashType),
  );
}

export async function waitUnlockTxCompleted(txhash: string) {
  console.log('Waiting for transaction confirmed...');
  while (true) {
    await asyncSleep(5000);
    const txRes = await ForceBridgeCore.ckb.rpc.getTransaction(txhash);
    console.log(`Tx status:${txRes.txStatus.status}`);
    if (txRes.txStatus.status === 'committed') {
      console.log('Unlock success.');
      break;
    }
  }
}
