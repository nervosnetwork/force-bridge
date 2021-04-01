import nconf from 'nconf';
import { ForceBridgeCore } from '../../packages/core';
import { Config } from '../../packages/config';
import { Account } from '../../packages/ckb/model/accounts';
import { Asset } from '../../packages/ckb/model/asset';
import { IndexerCollector } from '../../packages/ckb/tx-helper/collector';
import { Amount, Script } from '@lay2/pw-core';

export async function initConfig() {
  const configPath = process.env.CONFIG_PATH || './config-cli.json';
  nconf.env().file({ file: configPath });
  const config: Config = nconf.get('forceBridge');
  await new ForceBridgeCore().init(config);
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

export async function getSudtBalance(privateKey: string, asset: Asset): Promise<Amount> {
  const account = new Account(privateKey);
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

  const collector = new IndexerCollector(ForceBridgeCore.indexer);
  return await collector.getSUDTBalance(
    new Script(sudtType.codeHash, sudtType.args, sudtType.hashType),
    await account.getLockscript(),
  );
}
