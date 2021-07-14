import { core } from '@ckb-lumos/base';
import { CKBIndexerClient, SearchKey, SearchKeyFilter } from '@force-bridge/ckb-indexer-client';
import type * as Indexer from '@force-bridge/ckb-indexer-client';
import { FromRecord, ToRecord } from '@force-bridge/reconc';
import { Amount } from '@lay2/pw-core';
import { default as RPC } from '@nervosnetwork/ckb-sdk-rpc';
import { Observable, from } from 'rxjs';
import { map, expand, takeWhile, filter as rxFilter, mergeMap } from 'rxjs/operators';
import { Asset } from '../ckb/model/asset';
import { ScriptLike } from '../ckb/model/script';
import { RecipientCellData } from '../ckb/tx-helper/generated/eth_recipient_cell';
import { MintWitness } from '../ckb/tx-helper/generated/mint_witness';
import { fromHexString, uint8ArrayToString } from '../utils';

export interface CKBRecordObservableProvider {
  multiSigLock: ScriptLike;
  recipientType: ScriptLike;

  indexer: CKBIndexerClient;
  rpc: RPC;
  /**
   * parse a script to a mint recipient
   */
  scriptToAddress: (script: ScriptLike) => string;
}

export interface CKBMintFilter {
  // lock?: ScriptLike;
  fromBlock?: string;
  toBlock?: string;
  asset: Asset;
}

export interface CKBBurnFilter {
  fromBlock?: string; // hex string
  toBlock?: string; // hex string
  sender?: ScriptLike;
  filterRecipientData: (data: RecipientCellData) => boolean;
}

export class CKBRecordObservable {
  constructor(private provider: CKBRecordObservableProvider) {}

  observeMintRecord(filter: CKBMintFilter): Observable<ToRecord> {
    const { rpc, indexer: indexer, multiSigLock } = this.provider;
    const blockRange: SearchKeyFilter['block_range'] = [
      filter.fromBlock ? filter.fromBlock : '0x0',
      filter.toBlock ? filter.toBlock : '0xffffffffffffffff', // u64::Max
    ];

    // const filterLock = filter.lock ? { script: filter.lock.toIndexerScript() } : {};
    const searchKey: SearchKey = {
      filter: { block_range: blockRange },
      script: multiSigLock.toIndexerScript(),
      script_type: 'lock',
    };

    const sudtType = filter.asset.toTypeScript();

    const observable = from(indexer.get_transactions({ searchKey })).pipe(
      expand((res) => indexer.get_transactions({ searchKey, cursor: res.last_cursor })),
      takeWhile((res) => res.objects.length > 0),
      // mint tx outputs must contains at least one multi-sig lock
      mergeMap((res) => {
        const txHashes = res.objects
          .filter((cellPoint) => cellPoint.io_type === 'output')
          .map((point) => point.tx_hash);
        return new Set(txHashes);
      }),
      // resolve the transaction which contains the multi-sig lock cell
      mergeMap((txHash) => rpc.getTransaction(txHash), 20),
      // filter the transactions which contains target sudt(shadow asset)
      rxFilter((tx) => tx.transaction.outputs.some((cell) => cell.type && sudtType.equals(cell.type))),
      // parse to {@link ToRecord}
      mergeMap((tx) => {
        const witnessArgs = new core.WitnessArgs(fromHexString(tx.transaction.witnesses[0]).buffer);
        const inputTypeWitness = witnessArgs.getInputType().value().raw();
        const witness = new MintWitness(inputTypeWitness);
        // 1 mintTx : 1 lockTxHash
        // 1 sudtOutput : 1 lockTxHash
        const lockTxHashes = witness.getLockTxHashes();

        return tx.transaction.outputs.reduce((records, cell, i) => {
          if (!cell.type || !sudtType.equals(cell.type)) return records;

          const fromTxId = uint8ArrayToString(new Uint8Array(lockTxHashes.indexAt(records.length).raw()));
          const amount = Amount.fromUInt128LE(tx.transaction.outputsData[i]).toHexString();
          const txId = tx.transaction.hash;
          const fee = filter.asset.getBridgeFee('in');
          const recipient = this.provider.scriptToAddress(ScriptLike.from(cell.lock));

          const record: ToRecord = { amount, fromTxId, txId, fee, recipient };

          return records.concat(record);
        }, [] as ToRecord[]);
      }),
    );

    return observable;
  }

  observeBurnRecord(filter: CKBBurnFilter): Observable<FromRecord> {
    const blockRange: SearchKeyFilter['block_range'] = [
      filter.fromBlock ? filter.fromBlock : '0x0',
      filter.toBlock ? filter.toBlock : '0xffffffffffffffff', // u64::Max
    ];

    const searchKey: SearchKey = {
      script_type: 'type',
      script: this.provider.recipientType.toIndexerScript(),
      filter: { block_range: blockRange, script: filter.sender ? filter.sender.toIndexerScript() : undefined },
    };

    const { rpc, indexer } = this.provider;

    const indexerTx2FromRecord =
      () =>
      (txs$: Observable<Indexer.IndexerIterableResult<Indexer.GetTransactionsResult>>): Observable<FromRecord> => {
        return txs$.pipe(
          mergeMap((txs) => txs.objects.filter((indexerTx) => indexerTx.io_type === 'output')),
          mergeMap((tx) => rpc.getTransaction(tx.tx_hash), 20),
          map((tx) => {
            const recipientCellData = new RecipientCellData(fromHexString(tx.transaction.outputsData[0]).buffer);
            return { recipientCellData, txId: tx.transaction.hash };
          }),
          rxFilter((tx) => filter.filterRecipientData(tx.recipientCellData)),
          map((item) => {
            const u128leBuf = new Uint8Array(item.recipientCellData.getAmount().raw());
            const amount = BigInt('0x' + Buffer.from(u128leBuf).reverse().toString('hex')).toString();
            return { txId: item.txId, amount };
          }),
        );
      };

    return from(indexer.get_transactions({ searchKey })).pipe(
      expand((tx) => indexer.get_transactions({ searchKey, cursor: tx.last_cursor })),
      takeWhile((tx) => tx.objects.length > 0),
      indexerTx2FromRecord(),
    );
  }
}
