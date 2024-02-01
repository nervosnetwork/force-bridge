import { utils } from '@ckb-lumos/base';
import { WitnessArgs } from '@ckb-lumos/base/lib/blockchain';
import { SearchKey, IndexerTransactionList } from '@ckb-lumos/ckb-indexer/lib/type';
import { number } from '@ckb-lumos/codec';
import { HexadecimalRange, Indexer } from '@ckb-lumos/lumos';
import { CkbBurnRecord, CkbMintRecord, SudtRecord } from '@force-bridge/reconc';
import { default as RPC } from '@nervosnetwork/ckb-sdk-rpc';
import { Observable, from } from 'rxjs';
import { map, expand, takeWhile, filter as rxFilter, mergeMap, distinct, retry } from 'rxjs/operators';
import { Asset } from '../ckb/model/asset';
import { ScriptLike } from '../ckb/model/script';
import { RecipientCellData } from '../ckb/tx-helper/generated/eth_recipient_cell';
import { ForceBridgeLockscriptArgs } from '../ckb/tx-helper/generated/force_bridge_lockscript';
import { MintWitness } from '../ckb/tx-helper/generated/mint_witness';
import { ForceBridgeCore } from '../core';
import { fromHexString, toHexString, uint8ArrayToString } from '../utils';

export interface CKBRecordObservableProvider {
  ownerCellTypeHash: string;
  recipientType: ScriptLike;
  bridgeLock: ScriptLike;

  indexer: Indexer;
  rpc: RPC;
  /**
   * parse a script to a mint recipient
   */
  scriptToAddress: (script: ScriptLike) => string;
}

export interface Filter {
  fromBlock?: string; // hex string
  toBlock?: string; // hex string
}

export type CKBMintFilter = Filter & {
  // lock?: ScriptLike;
  asset?: Asset;
};

export type CKBBurnFilter = Filter & {
  sender?: ScriptLike;
  filterRecipientData: (data: RecipientCellData) => boolean;
};

function isTypeIDCorrect(args: string, expectOwnerTypeHash: string): boolean {
  const bridgeLockArgs = new ForceBridgeLockscriptArgs(fromHexString(args).buffer);
  const ownerTypeHash = `0x${toHexString(new Uint8Array(bridgeLockArgs.getOwnerCellTypeHash().raw()))}`;
  return ownerTypeHash === expectOwnerTypeHash;
}

export class CKBRecordObservable {
  constructor(private provider: CKBRecordObservableProvider) {}

  observeSudtRecord(filter: Filter): Observable<SudtRecord[]> {
    const { rpc, indexer: indexer } = this.provider;

    const searchKey: SearchKey = {
      filter: { blockRange: [filter.fromBlock ?? '0x0', filter.toBlock ?? '0xffffffffffffffff'] },
      script: {
        codeHash: ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash,
        hashType: ForceBridgeCore.config.ckb.deps.sudtType.script.hashType,
        args: '0x',
      },
      scriptType: 'type',
    };

    const observable = from(indexer.getTransactions(searchKey)).pipe(
      retry(2),
      takeWhile((res) => res.objects.length > 0),
      mergeMap((res) => res.objects),
      mergeMap(async (getTxResult) => {
        try {
          const records: SudtRecord[] = [];
          const tx = await rpc.getTransaction(getTxResult.txHash);
          const inputs = tx.transaction.inputs;
          for (let i = 0; i < inputs.length; i++) {
            const input = inputs[i];
            if (input.previousOutput) {
              const tx = await rpc.getTransaction(input.previousOutput.txHash);
              const output = tx.transaction.outputs[parseInt(input.previousOutput.index)];
              if (
                output.type &&
                output.type.codeHash == searchKey.script.codeHash &&
                output.type.hashType == searchKey.script.hashType
              ) {
                records.push({
                  index: i,
                  txId: getTxResult.txHash,
                  amount: tx.transaction.outputsData[parseInt(input.previousOutput.index)],
                  lock: this.provider.scriptToAddress(ScriptLike.from(output.lock)),
                  direction: 'out',
                  token: utils.computeScriptHash({
                    hashType: output.type.hashType,
                    codeHash: output.type.codeHash,
                    args: output.type.args,
                  }),
                });
              }
            }
          }

          tx.transaction.outputs.forEach((v, k) => {
            if (
              v.type &&
              v.type.codeHash == searchKey.script.codeHash &&
              v.type.hashType == searchKey.script.hashType
            ) {
              records.push({
                index: k,
                txId: tx.transaction.hash,
                amount: tx.transaction.outputsData[k],
                lock: this.provider.scriptToAddress(ScriptLike.from(v.lock)),
                direction: 'in',
                token: utils.computeScriptHash({
                  hashType: v.type.hashType,
                  codeHash: v.type.codeHash,
                  args: v.type.args,
                }),
              });
            }
          });
          return records;
        } catch (e) {
          return [];
        }
      }),
    );
    return observable;
  }

  observeMintRecord(filter: CKBMintFilter): Observable<CkbMintRecord> {
    const { rpc, indexer: indexer, ownerCellTypeHash, bridgeLock } = this.provider;
    const blockRange: HexadecimalRange = [
      filter.fromBlock ? filter.fromBlock : '0x0',
      filter.toBlock ? filter.toBlock : '0xffffffffffffffff', // u64::Max
    ];

    const searchKey: SearchKey = {
      filter: { blockRange },
      script: bridgeLock,
      scriptType: 'lock',
    };

    const observable = from(indexer.getTransactions(searchKey)).pipe(
      expand(({ lastCursor }) => indexer.getTransactions(searchKey, { lastCursor })),
      takeWhile((res) => res.objects.length > 0),
      mergeMap((res) => res.objects),
      rxFilter((res) => res.ioType === 'output'),
      distinct((res) => res.txHash),
      mergeMap(async (getTxResult) => {
        const tx = await rpc.getTransaction(getTxResult.txHash);
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
          const witnessArgs = WitnessArgs.unpack(fromHexString(tx.transaction.witnesses[0]).buffer);
          const inputTypeWitness = witnessArgs.inputType;
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
            const amount = number.Uint128LE.unpack(tx.transaction.outputsData[i]).toString(0);
            const txId = tx.transaction.hash;
            let fee = '-1';
            if (filter.asset) {
              fee = filter.asset.getBridgeFee('in');
            }

            const recipient = this.provider.scriptToAddress(ScriptLike.from(cell.lock));
            const blockHash = tx.txStatus.blockHash || '';
            const blockNumber = parseInt(res.getTxResult.blockNumber, 16);
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
    const blockRange: HexadecimalRange = [
      filter.fromBlock ? filter.fromBlock : '0x0',
      filter.toBlock ? filter.toBlock : '0xffffffffffffffff', // u64::Max
    ];

    const searchKey: SearchKey = {
      scriptType: 'type',
      script: this.provider.recipientType,
      filter: { blockRange: blockRange, script: filter.sender ?? filter.sender },
    };

    const { rpc, indexer } = this.provider;

    const indexerTx2FromRecord = () => (txs$: Observable<IndexerTransactionList>): Observable<CkbBurnRecord> => {
      return txs$.pipe(
        mergeMap((txs) => txs.objects.filter((indexerTx) => indexerTx.ioType === 'output')),
        mergeMap((tx) => rpc.getTransaction(tx.txHash), 20),
        map((tx) => {
          const recipientCellData = new RecipientCellData(fromHexString(tx.transaction.outputsData[0]).buffer);
          return { recipientCellData, txId: tx.transaction.hash };
        }),
        rxFilter((tx) => {
          if (!filter.filterRecipientData(tx.recipientCellData)) {
            return false;
          }
          return true;
          // const assetAddress = toHexString(new Uint8Array(tx.recipientCellData.getAsset().raw()));
          // let asset;
          // const ownerTypeHash = getOwnerTypeHash();
          // switch (tx.recipientCellData.getChain()) {
          //   case ChainType.BTC:
          //     asset = new BtcAsset(uint8ArrayToString(fromHexString(assetAddress)), ownerTypeHash);
          //     break;
          //   case ChainType.ETH:
          //     asset = new EthAsset(uint8ArrayToString(fromHexString(assetAddress)), ownerTypeHash);
          //     break;
          //   case ChainType.TRON:
          //     asset = new TronAsset(uint8ArrayToString(fromHexString(assetAddress)), ownerTypeHash);
          //     break;
          //   case ChainType.EOS:
          //     asset = new EosAsset(uint8ArrayToString(fromHexString(assetAddress)), ownerTypeHash);
          //     break;
          //   default:
          //     return false;
          // }
          // return (
          //   asset.inWhiteList() &&
          //   utils.readBigUInt128LE(`0x${toHexString(new Uint8Array(tx.recipientCellData.getAmount().raw()))}`) >=
          //     BigInt(asset.getMinimalAmount())
          // );
        }),

        map((item) => {
          const u128leBuf = new Uint8Array(item.recipientCellData.getAmount().raw());
          const amount = BigInt('0x' + Buffer.from(u128leBuf).reverse().toString('hex')).toString();
          const recipient = Buffer.from(new Uint8Array(item.recipientCellData.getRecipientAddress().raw())).toString();
          const asset = Buffer.from(new Uint8Array(item.recipientCellData.getAsset().raw())).toString();
          const chain = item.recipientCellData.getChain();
          return { txId: item.txId, amount, recipient, token: asset, chain };
        }),
      );
    };

    return from(indexer.getTransactions(searchKey)).pipe(
      expand((tx) => indexer.getTransactions(searchKey, { lastCursor: tx.lastCursor })),
      takeWhile((tx) => tx.objects.length > 0),
      indexerTx2FromRecord(),
    );
  }
}
