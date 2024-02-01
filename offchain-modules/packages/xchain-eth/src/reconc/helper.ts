import { encodeToAddress } from '@ckb-lumos/helpers';
import { Indexer, Script } from '@ckb-lumos/lumos';
import { ScriptLike } from '@force-bridge/x/dist/ckb/model/script';
import { getOwnerTypeHash } from '@force-bridge/x/dist/ckb/tx-helper/multisig/multisig_helper';
import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { CKBRecordObservable } from '@force-bridge/x/dist/reconc/CKBRecordObservable';
import { default as CKB } from '@nervosnetwork/ckb-sdk-core';
import { ethers } from 'ethers';
import { TwoWayRecordObservable } from './EthReconcilerBuilder';
import { EthRecordObservable } from './EthRecordObservable';

function getRecipientTypeScript(): Script {
  return {
    codeHash: ForceBridgeCore.config.ckb.deps.recipientType.script.codeHash,
    hashType: ForceBridgeCore.config.ckb.deps.recipientType.script.hashType,
    args: '0x',
  };
}

function getBridgeLockscript(): Script {
  return {
    codeHash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
    hashType: ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
    args: '0x',
  };
}

export function createProvider(): ethers.providers.JsonRpcProvider {
  return new ethers.providers.JsonRpcProvider(ForceBridgeCore.config.eth.rpcUrl);
}

export function createCKBRecordObservable(): CKBRecordObservable {
  return new CKBRecordObservable({
    indexer: new Indexer(ForceBridgeCore.ckbIndexer.ckbIndexerUrl),
    rpc: ForceBridgeCore.ckb.rpc,
    ownerCellTypeHash: getOwnerTypeHash(),
    recipientType: ScriptLike.from(getRecipientTypeScript()),
    bridgeLock: ScriptLike.from(getBridgeLockscript()),
    scriptToAddress: (script) => encodeToAddress(script),
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
