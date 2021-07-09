import type * as Indexer from '@force-bridge/ckb-indexer-client';
import { CKBIndexerClient } from '@force-bridge/ckb-indexer-client';
import { FromRecord, Reconciler, Reconciliation, ToRecord } from '@force-bridge/reconc';
import { Account } from '@force-bridge/x/dist/ckb/model/accounts';
import { EthAsset } from '@force-bridge/x/dist/ckb/model/asset';
import { ScriptLike } from '@force-bridge/x/dist/ckb/model/script';
import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { CKBRecordFetcher } from '@force-bridge/x/dist/reconc/CKBRecordFetcher';
import { uint8ArrayToString } from '@force-bridge/x/dist/utils';
import CKB from '@nervosnetwork/ckb-sdk-core';
import { default as RPC } from '@nervosnetwork/ckb-sdk-rpc';
import { ethers } from 'ethers';
import { firstValueFrom } from 'rxjs';
import { toArray } from 'rxjs/operators';
import { ForceBridge as ForceBridgeContract } from './generated/contract';

function getRecipientTypeScript(): Indexer.Script {
  return {
    code_hash: ForceBridgeCore.config.ckb.deps.recipientType.script.codeHash,
    hash_type: ForceBridgeCore.config.ckb.deps.recipientType.script.hashType,
    args: '0x',
  };
}

export interface EthReconcilerAdapter {
  readonly ckbIndexer: CKBIndexerClient;
  readonly ckb: CKB;
  readonly ethersProvider: ethers.providers.Provider;
  readonly ethContract: ForceBridgeContract;
}

export interface EthLockReconcilerAdapter extends EthReconcilerAdapter {
  bridgeLockScript: ScriptLike;
}

export class EthLockReconciler implements Reconciler {
  constructor(
    readonly account: string,
    readonly asset: string,
    private readonly provider: ethers.providers.Provider,
    private readonly contract: ForceBridgeContract,
    private readonly ckbIndexer: CKBIndexerClient,
    private readonly ckbRpc: RPC,
  ) {}

  async getFromRecordsByOnChainState(): Promise<FromRecord[]> {
    const { contract, provider } = this;
    const contractLogFilter = contract.filters.Locked(this.asset, this.account);

    const logs = await provider.getLogs({ ...contractLogFilter, fromBlock: 0 });
    return logs.map((rawLog) => {
      const parsedLog = contract.interface.parseLog(rawLog);
      return { amount: parsedLog.args.lockedAmount.toString(), txId: rawLog.transactionHash };
    });
  }

  async getToRecordsByLocalState(): Promise<ToRecord[]> {
    const observable = new CKBRecordFetcher({
      indexer: this.ckbIndexer,
      rpc: this.ckbRpc,
      multiSigLock: ScriptLike.from(ForceBridgeCore.config.ckb.multisigLockscript),
      recipientType: ScriptLike.from(getRecipientTypeScript()),
      scriptToAddress: Account.scriptToAddress,
    }).observeMintRecord({
      asset: new EthAsset(this.asset),
    });

    return firstValueFrom(observable.pipe(toArray()));
  }

  async fetchReconciliation(): Promise<Reconciliation> {
    const [from, to] = await Promise.all([this.getFromRecordsByOnChainState(), this.getToRecordsByLocalState()]);
    return new Reconciliation(from, to);
  }
}

export class EthUnlockReconciler implements Reconciler {
  readonly account: string;

  readonly asset: string;

  readonly ownerCellTypeHash: string;

  // private indexer: CKBIndexerClient;

  constructor(
    nervosLockscriptAddress: string,
    ethAssetAddress: string,
    ownerCellTypeHash: string,
    private ckbIndexer: CKBIndexerClient,
    private ckbRpc: CKB['rpc'],
    private provider: ethers.providers.Provider,
    private contract: ForceBridgeContract,
  ) {
    this.account = nervosLockscriptAddress;
    this.asset = ethAssetAddress;
    this.ownerCellTypeHash = ownerCellTypeHash;
  }

  async getFromRecordsByOnChainState(): Promise<FromRecord[]> {
    const fetcher = new CKBRecordFetcher({
      indexer: this.ckbIndexer,
      rpc: this.ckbRpc,
      multiSigLock: ScriptLike.from(ForceBridgeCore.config.ckb.multisigLockscript),
      recipientType: ScriptLike.from(getRecipientTypeScript()),
      scriptToAddress: Account.scriptToAddress,
    });

    const fromRecords$ = fetcher.observeBurnRecord({
      filterRecipientData: (data) => {
        const assetBuffer = data.getAsset().raw();
        const assetAddress = uint8ArrayToString(new Uint8Array(assetBuffer));
        const ownerCellTypeHash = Buffer.from(data.getOwnerCellTypeHash().raw()).toString('hex');
        return (
          this.asset.toLowerCase() === assetAddress.toLowerCase() &&
          ownerCellTypeHash === this.ownerCellTypeHash.slice(2)
        );
      },
    });

    return firstValueFrom(fromRecords$.pipe(toArray()));
  }

  async getToRecordsByLocalState(): Promise<ToRecord[]> {
    const filter = this.contract.filters.Unlocked(this.asset);
    const logs = await this.provider.getLogs({ ...filter, fromBlock: 0 });

    return logs.map<ToRecord>((rawLog) => {
      const parsedLog = this.contract.interface.parseLog(rawLog);
      const { token, receivedAmount, ckbTxHash: fromTxId, recipient } = parsedLog.args;
      const txId = rawLog.transactionHash;
      const fee = new EthAsset(token).getBridgeFee('out');
      return { amount: String(receivedAmount), fromTxId, recipient, txId, fee };
    });
  }

  async fetchReconciliation(): Promise<Reconciliation> {
    const [from, to] = await Promise.all([this.getFromRecordsByOnChainState(), this.getToRecordsByLocalState()]);
    return new Reconciliation(from, to);
  }
}

/**
 * @example
 * const provider = new ethers.providers.JsonRpcProvider(url);
 * const contract = new ethers.Contract(contractAddress, abi) as unknown) as ForceBridgeContract;
 * const ethDb = new EthDb(conn);
 *
 * const builder = new EthReconcilerBuilder(provider, contract, ethDb, ckbIndexer, ckbRpc);
 *
 * const reconc = await builder.buildLockReconciler(lockAccountAddress, erc20Address).fetchReconciliation();
 * reconc.checkBalanced();
 */
export class EthReconcilerBuilder {
  // TODO refactor to Provider mode
  constructor(
    private provider: ethers.providers.Provider,
    private contract: ForceBridgeContract,
    private ckbIndexer: CKBIndexerClient,
    private ckbRpc: CKB['rpc'],
  ) {}

  buildLockReconciler(ethAccountAddress: string, ethAssetAddress: string): EthLockReconciler {
    // return new EthLockReconciler(ethAccountAddress, ethAssetAddress, this.provider, this.contract, this.ethDb);
    return new EthLockReconciler(
      ethAccountAddress,
      ethAssetAddress,
      this.provider,
      this.contract,
      this.ckbIndexer,
      this.ckbRpc,
    );
  }

  buildUnlockReconciler(
    nervosLockscriptAddress: string,
    ethAssetAddress: string,
    ownerCellTypeHash: string,
  ): EthUnlockReconciler {
    return new EthUnlockReconciler(
      nervosLockscriptAddress,
      ethAssetAddress,
      ownerCellTypeHash,
      this.ckbIndexer,
      this.ckbRpc,
      this.provider,
      this.contract,
    );
  }
}
