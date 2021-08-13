import { core, utils } from '@ckb-lumos/base';
import { CKBIndexerClient, SearchKey, SearchKeyFilter } from '@force-bridge/ckb-indexer-client';
import type * as Indexer from '@force-bridge/ckb-indexer-client';
import { CkbBurnRecord, CkbMintRecord } from '@force-bridge/reconc';
import { Amount } from '@lay2/pw-core';
import { default as RPC } from '@nervosnetwork/ckb-sdk-rpc';
import { Observable, from } from 'rxjs';
import { map, expand, takeWhile, filter as rxFilter, mergeMap, distinct } from 'rxjs/operators';
import { Asset, BtcAsset, ChainType, EosAsset, EthAsset, TronAsset } from '../ckb/model/asset';
import { ScriptLike } from '../ckb/model/script';
import { RecipientCellData } from '../ckb/tx-helper/generated/eth_recipient_cell';
import { ForceBridgeLockscriptArgs } from '../ckb/tx-helper/generated/force_bridge_lockscript';
import { MintWitness } from '../ckb/tx-helper/generated/mint_witness';
import { getOwnerTypeHash } from '../ckb/tx-helper/multisig/multisig_helper';
import { fromHexString, toHexString, uint8ArrayToString } from '../utils';

export interface CKBRecordObservableProvider {
  ownerCellTypeHash: string;
  recipientType: ScriptLike;
  bridgeLock: ScriptLike;

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
  asset?: Asset;
}

export interface CKBBurnFilter {
  fromBlock?: string; // hex string
  toBlock?: string; // hex string
  sender?: ScriptLike;
  filterRecipientData: (data: RecipientCellData) => boolean;
}

function isTypeIDCorrect(args: string, expectOwnerTypeHash: string): boolean {
  const bridgeLockArgs = new ForceBridgeLockscriptArgs(fromHexString(args).buffer);
  const ownerTypeHash = `0x${toHexString(new Uint8Array(bridgeLockArgs.getOwnerCellTypeHash().raw()))}`;
  return ownerTypeHash === expectOwnerTypeHash;
}

export class CKBRecordObservable {
  constructor(private provider: CKBRecordObservableProvider) {}

  observeMintRecord(filter: CKBMintFilter): Observable<CkbMintRecord> {
    const { rpc, indexer: indexer, ownerCellTypeHash, bridgeLock } = this.provider;
    const blockRange: SearchKeyFilter['block_range'] = [
      filter.fromBlock ? filter.fromBlock : '0x0',
      filter.toBlock ? filter.toBlock : '0xffffffffffffffff', // u64::Max
    ];

    const searchKey: SearchKey = {
      filter: { block_range: blockRange },
      script: bridgeLock.toIndexerScript(),
      script_type: 'lock',
    };

    const observable = from(indexer.get_transactions({ searchKey })).pipe(
      expand((res) => indexer.get_transactions({ searchKey, cursor: res.last_cursor })),
      takeWhile((res) => res.objects.length > 0),
      mergeMap((res) => res.objects),
      rxFilter((getTxResult: Indexer.GetTransactionsResult) => getTxResult.io_type === 'output'),
      distinct((res) => res.tx_hash),
      mergeMap(async (getTxResult) => {
        const tx = await rpc.getTransaction(getTxResult.tx_hash);
        return { tx, getTxResult };
      }, 20),
      rxFilter((res) => {
        return res.tx.transaction.outputs.some((cell) => {
          return (
            cell.lock.hashType === bridgeLock.hashType &&
            cell.lock.codeHash === bridgeLock.codeHash &&
            isTypeIDCorrect(cell.lock.args, ownerCellTypeHash)
          );
        });
      }),
      // filter the transactions which contains target sudt(shadow asset)
      rxFilter((res) => {
        return res.tx.transaction.outputs.some((cell) => {
          if (!filter.asset) {
            return true;
          }
          const sudtType = filter.asset.toTypeScript();
          return cell.type && sudtType.equals(cell.type);
        });
      }),
      // parse to {@link ToRecord}
      mergeMap((res) => {
        try {
          const tx = res.tx;
          const witnessArgs = new core.WitnessArgs(fromHexString(tx.transaction.witnesses[0]).buffer);
          const inputTypeWitness = witnessArgs.getInputType().value().raw();
          const witness = new MintWitness(inputTypeWitness, { validate: true });
          // 1 mintTx : 1 lockTxHash
          // 1 sudtOutput : 1 lockTxHash
          const lockTxHashes = witness.getLockTxHashes();

          return tx.transaction.outputs.reduce((records, cell, i) => {
            if (!cell.type) {
              return records;
            }
            if (filter.asset) {
              const sudtType = filter.asset.toTypeScript();
              if (!sudtType.equals(cell.type)) {
                return records;
              }
            }

            const fromTxId = uint8ArrayToString(new Uint8Array(lockTxHashes.indexAt(records.length).raw()));
            const amount = Amount.fromUInt128LE(tx.transaction.outputsData[i]).toString(0);
            const txId = tx.transaction.hash;
            let fee = '-1';
            if (filter.asset) {
              fee = filter.asset.getBridgeFee('in');
            }

            const recipient = this.provider.scriptToAddress(ScriptLike.from(cell.lock));
            const blockHash = tx.txStatus.blockHash || '';
            const blockNumber = parseInt(res.getTxResult.block_number, 16);
            const record: CkbMintRecord = { amount, fromTxId, txId, fee, recipient, blockHash, blockNumber };
            return records.concat(record);
          }, [] as CkbMintRecord[]);
        } catch (e) {
          return [] as CkbMintRecord[];
        }
      }),
    );

    return observable as Observable<CkbMintRecord>;
  }

  observeBurnRecord(filter: CKBBurnFilter): Observable<CkbBurnRecord> {
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
      (txs$: Observable<Indexer.IndexerIterableResult<Indexer.GetTransactionsResult>>): Observable<CkbBurnRecord> => {
        return txs$.pipe(
          mergeMap((txs) => txs.objects.filter((indexerTx) => indexerTx.io_type === 'output')),
          mergeMap((tx) => rpc.getTransaction(tx.tx_hash), 20),
          map((tx) => {
            const recipientCellData = new RecipientCellData(fromHexString(tx.transaction.outputsData[0]).buffer);
            return { recipientCellData, txId: tx.transaction.hash };
          }),
          rxFilter((tx) => {
            if (!filter.filterRecipientData(tx.recipientCellData)) {
              return false;
            }
            const assetAddress = toHexString(new Uint8Array(tx.recipientCellData.getAsset().raw()));
            let asset;
            const ownerTypeHash = getOwnerTypeHash();
            switch (tx.recipientCellData.getChain()) {
              case ChainType.BTC:
                asset = new BtcAsset(uint8ArrayToString(fromHexString(assetAddress)), ownerTypeHash);
                break;
              case ChainType.ETH:
                asset = new EthAsset(uint8ArrayToString(fromHexString(assetAddress)), ownerTypeHash);
                break;
              case ChainType.TRON:
                asset = new TronAsset(uint8ArrayToString(fromHexString(assetAddress)), ownerTypeHash);
                break;
              case ChainType.EOS:
                asset = new EosAsset(uint8ArrayToString(fromHexString(assetAddress)), ownerTypeHash);
                break;
              default:
                return false;
            }
            return (
              asset.inWhiteList() &&
              utils.readBigUInt128LE(`0x${toHexString(new Uint8Array(tx.recipientCellData.getAmount().raw()))}`) >=
                BigInt(asset.getMinimalAmount())
            );
          }),

          map((item) => {
            const u128leBuf = new Uint8Array(item.recipientCellData.getAmount().raw());
            const amount = BigInt('0x' + Buffer.from(u128leBuf).reverse().toString('hex')).toString();
            const recipient = Buffer.from(
              new Uint8Array(item.recipientCellData.getRecipientAddress().raw()),
            ).toString();
            const asset = Buffer.from(new Uint8Array(item.recipientCellData.getAsset().raw())).toString();
            const chain = item.recipientCellData.getChain();
            return { txId: item.txId, amount, recipient, token: asset, chain };
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
