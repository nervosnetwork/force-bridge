import { Account } from '@force-bridge/x/dist/ckb/model/accounts';
import { Asset } from '@force-bridge/x/dist/ckb/model/asset';
import { IndexerCollector } from '@force-bridge/x/dist/ckb/tx-helper/collector';
import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { asyncSleep } from '@force-bridge/x/dist/utils';
import { Amount, HashType, Script } from '@lay2/pw-core';
import CKB from '@nervosnetwork/ckb-sdk-core';

export function parseOptions(opts: Record<string, boolean>, args: string[]): Map<string, string> {
  const optionMap = new Map<string, string>();
  let index = 0;
  for (const o in opts) {
    if (opts[o] === undefined) {
      continue;
    }
    optionMap.set(o, args[index]);
    index++;
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
  const collector = new IndexerCollector(ForceBridgeCore.ckbIndexer);
  return await collector.getSUDTBalance(
    new Script(sudtType.codeHash, sudtType.args, sudtType.hashType),
    new Script(userScript.codeHash, userScript.args, userScript.hashType as HashType),
  );
}

export async function waitUnlockCompleted(ckb: CKB, txhash: string): Promise<void> {
  console.log('Waiting for transaction confirmed...');
  while (true) {
    await asyncSleep(5000);
    const txRes = await ckb.rpc.getTransaction(txhash);
    console.log(`Tx status:${txRes.txStatus.status}`);
    if (txRes.txStatus.status === 'committed') {
      console.log('Unlock success.');
      break;
    }
  }
}

export function ckbPrivateKeyToAddress(privateKey: string, network = 'testnet'): string {
  return new Account(privateKey, network).address;
}
