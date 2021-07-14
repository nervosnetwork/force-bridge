import { CKBIndexerClient, Script as IndexerScript } from '@force-bridge/ckb-indexer-client';
import { Account } from '@force-bridge/x/dist/ckb/model/accounts';
import { ScriptLike } from '@force-bridge/x/dist/ckb/model/script';
import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { CKBRecordObservable } from '@force-bridge/x/dist/reconc/CKBRecordObservable';
import { default as CKB } from '@nervosnetwork/ckb-sdk-core';
import { ethers } from 'ethers';
import { TwoWayRecordObservable } from './EthReconcilerBuilder';
import { EthRecordObservable } from './EthRecordObservable';

function getRecipientTypeScript(): IndexerScript {
  return {
    code_hash: ForceBridgeCore.config.ckb.deps.recipientType.script.codeHash,
    hash_type: ForceBridgeCore.config.ckb.deps.recipientType.script.hashType,
    args: '0x',
  };
}
export function createProvider(): ethers.providers.JsonRpcProvider {
  return new ethers.providers.JsonRpcProvider(ForceBridgeCore.config.eth.rpcUrl);
}

export function createCKBRecordObservable(): CKBRecordObservable {
  return new CKBRecordObservable({
    indexer: new CKBIndexerClient(ForceBridgeCore.ckbIndexer.ckbIndexerUrl),
    rpc: ForceBridgeCore.ckb.rpc,
    multiSigLock: ScriptLike.from(ForceBridgeCore.config.ckb.multisigLockscript),
    recipientType: ScriptLike.from(getRecipientTypeScript()),
    scriptToAddress: Account.scriptToAddress,
  });
}

export function createETHRecordObservable(): EthRecordObservable {
  return new EthRecordObservable({
    contract: ForceBridgeCore.config.eth.contractAddress,
    provider: createProvider(),
  });
}

export function createTwoWayRecordObservable(): TwoWayRecordObservable {
  return {
    ckbRecordObservable: createCKBRecordObservable(),
    xchainRecordObservable: createETHRecordObservable(),
  };
}

export function createCKBRpc(): CKB['rpc'] {
  return ForceBridgeCore.ckb.rpc;
}
