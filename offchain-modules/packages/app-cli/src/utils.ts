import { parseAddress } from '@ckb-lumos/helpers';
import { Asset } from '@force-bridge/x/dist/ckb/model/asset';
import { IndexerCollector } from '@force-bridge/x/dist/ckb/tx-helper/collector';
import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { asyncSleep } from '@force-bridge/x/dist/utils';
import CKB from '@nervosnetwork/ckb-sdk-core';

export async function getSudtBalance(address: string, asset: Asset): Promise<bigint> {
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

  const userScript = parseAddress(address);
  const collector = new IndexerCollector(ForceBridgeCore.ckbIndexer);
  const amount = await collector.getSUDTBalance(sudtType, userScript);
  return amount;
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
