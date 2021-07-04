import type * as Indexer from '@force-bridge/ckb-indexer-client';
import { CKBIndexerClient } from '@force-bridge/ckb-indexer-client';
import { FromRecord, Reconciler, Reconciliation, ToRecord } from '@force-bridge/reconc';
import { RecipientCellData } from '@force-bridge/x/dist/ckb/tx-helper/generated/eth_recipient_cell';
import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { fromHexString, uint8ArrayToString } from '@force-bridge/x/dist/utils';
import CKB from '@nervosnetwork/ckb-sdk-core';
import { ethers } from 'ethers';
import { firstValueFrom, from, Observable } from 'rxjs';
import { expand, filter, map, mergeMap, takeWhile, toArray } from 'rxjs/operators';
import { ForceBridge as ForceBridgeContract } from './generated/contract';
import { EthDb } from './local';

const CKB_GET_TRANSACTION_CONCURRENCY = 10;

export class EthLockReconciler implements Reconciler {
  constructor(
    readonly account: string,
    readonly asset: string,
    private readonly provider: ethers.providers.Provider,
    private readonly contract: ForceBridgeContract,
    private readonly db: EthDb,
  ) {}

  async getFromRecordsByOnChainState(): Promise<FromRecord[]> {
    const contractLogFilter = this.contract.filters.Locked(this.asset, this.account);

    const logs = await this.provider.getLogs({ ...contractLogFilter, fromBlock: 0 });
    return logs.map((rawLog) => {
      const parsedLog = this.contract.interface.parseLog(rawLog);
      return { amount: parsedLog.args.lockedAmount.toString(), txId: rawLog.transactionHash };
    });
  }

  async getToRecordsByLocalState(): Promise<ToRecord[]> {
    const records = await this.db.getLockRecordsByXChainAddress(this.account, this.asset);

    return records.map<ToRecord>((record) => ({
      txId: record.mint_hash,
      amount: record.mint_amount,
      recipient: record.recipient,
      // TODO
      fee: record.bridge_fee,
    }));
  }

  async fetchReconciliation(): Promise<Reconciliation> {
    const [from, to] = await Promise.all([this.getFromRecordsByOnChainState(), this.getToRecordsByLocalState()]);
    return new Reconciliation(from, to);
  }
}

async function getRecipientTypeScript(): Promise<Indexer.Script> {
  return {
    code_hash: ForceBridgeCore.config.ckb.deps.recipientType.script.codeHash,
    hash_type: ForceBridgeCore.config.ckb.deps.recipientType.script.hashType,
    args: '0x',
  };
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
    private ethDb: EthDb,
  ) {
    this.account = nervosLockscriptAddress;
    this.asset = ethAssetAddress;
    this.ownerCellTypeHash = ownerCellTypeHash;
  }

  async getFromRecordsByOnChainState(): Promise<FromRecord[]> {
    const script = ForceBridgeCore.ckb.utils.addressToScript(this.account);
    const searchKey: Indexer.GetTransactionParams['searchKey'] = {
      script_type: 'lock',
      script: { args: script.args, code_hash: script.codeHash, hash_type: script.hashType },
      filter: { script: await getRecipientTypeScript() },
    };

    const indexerTx2FromRecord =
      () =>
      (txs$: Observable<Indexer.IndexerIterableResult<Indexer.GetTransactionsResult>>): Observable<FromRecord> => {
        return txs$.pipe(
          mergeMap((txs) => txs.objects.filter((indexerTx) => indexerTx.io_type === 'output')),
          mergeMap((tx) => this.ckbRpc.getTransaction(tx.tx_hash), CKB_GET_TRANSACTION_CONCURRENCY),
          map((tx) => {
            const recipientCellData = new RecipientCellData(fromHexString(tx.transaction.outputsData[0]).buffer);
            return { recipientCellData, txId: tx.transaction.hash };
          }),
          filter((tx) => {
            const assetBuffer = tx.recipientCellData.getAsset().raw();
            const assetAddress = uint8ArrayToString(new Uint8Array(assetBuffer));
            const ownerCellTypeHash = Buffer.from(tx.recipientCellData.getOwnerCellTypeHash().raw()).toString('hex');
            return (
              this.asset.toLowerCase() === assetAddress.toLowerCase() &&
              ownerCellTypeHash === this.ownerCellTypeHash.slice(2)
            );
          }),
          map((item) => {
            const u128leBuf = new Uint8Array(item.recipientCellData.getAmount().raw());
            const amount = BigInt('0x' + Buffer.from(u128leBuf).reverse().toString('hex')).toString();
            return { txId: item.txId, amount };
          }),
        );
      };

    return firstValueFrom(
      from(this.ckbIndexer.get_transactions({ searchKey })).pipe(
        expand((tx) => this.ckbIndexer.get_transactions({ searchKey, cursor: tx.last_cursor })),
        takeWhile((tx) => tx.objects.length > 0),
        indexerTx2FromRecord(),
        toArray(),
      ),
    );
  }

  async getToRecordsByLocalState(): Promise<ToRecord[]> {
    const records = await this.ethDb.getUnlockRecordsByCkbAddress(this.account, this.asset);
    return records.map((record) => ({
      txId: record.unlock_hash,
      amount: record.unlock_amount,
      recipient: record.recipient,
      fee: record.bridge_fee,
    }));
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
    private ethDb: EthDb,
    private ckbIndexer: CKBIndexerClient,
    private ckbRpc: CKB['rpc'],
  ) {}

  buildLockReconciler(ethAccountAddress: string, ethAssetAddress: string): EthLockReconciler {
    return new EthLockReconciler(ethAccountAddress, ethAssetAddress, this.provider, this.contract, this.ethDb);
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
      this.ethDb,
    );
  }
}
