import {
  CellCollector,
  CellCollectorResults,
  Hexadecimal,
  Indexer,
  QueryOptions,
  Script as LumosScript,
  Tip,
} from '@ckb-lumos/base';
import { RPC } from '@ckb-lumos/rpc';
import { OutPoint, Script } from '@lay2/pw-core';
import axios from 'axios';
import { nonNullable } from '../../errors';
import { asyncSleep } from '../../utils';
import { logger } from '../../utils/logger';

export enum ScriptType {
  type = 'type',
  lock = 'lock',
}

export enum Order {
  asc = 'asc',
  desc = 'desc',
}

export type HexadecimalRange = [Hexadecimal, Hexadecimal];

export interface SearchKey {
  script: LumosScript;
  script_type: ScriptType;
  filter?: {
    script?: LumosScript;
    output_data_len_range?: HexadecimalRange;
    output_capacity_range?: HexadecimalRange;
    block_range?: HexadecimalRange;
  };
}

export type HexString = string;
export type Hash = HexString;

export interface IndexerCell {
  capacity: HexString;
  lock: Script;
  type: Script;
  outPoint: OutPoint;
  data: HexString;
}

export interface TerminatorResult {
  stop: boolean;
  push: boolean;
}

export declare type Terminator = (index: number, cell: IndexerCell) => TerminatorResult;

const DefaultTerminator: Terminator = (_index, _cell) => {
  return { stop: false, push: true };
};

export class CkbIndexer implements Indexer {
  private ckbRpc: RPC;
  uri: string;

  constructor(public ckbRpcUrl: string, public ckbIndexerUrl: string) {
    this.uri = ckbRpcUrl;
    this.ckbRpc = new RPC(ckbRpcUrl);
  }

  async tip(): Promise<Tip> {
    const res = await this.request('get_tip');
    return res as Tip;
  }

  async waitForSync(blockDifference = 0): Promise<void> {
    const rpcTipNumber = parseInt((await this.ckbRpc.get_tip_header()).number, 16);
    logger.debug('rpcTipNumber', rpcTipNumber);
    let index = 0;
    while (true) {
      const indexerTipNumber = parseInt((await this.tip()).block_number, 16);
      logger.debug('indexerTipNumber', indexerTipNumber);
      if (indexerTipNumber + blockDifference >= rpcTipNumber) {
        return;
      }
      logger.debug(`wait until indexer sync. index: ${index++}`);
      await asyncSleep(1000);
    }
  }

  /*
   * Addtional note:
   * Only accept lock and type parameters as `Script` type, along with `data` field in QueryOptions. Use it carefully!
   * */
  collector(queries: QueryOptions): CellCollector {
    const { lock, type } = queries;
    let searchKey: SearchKey;
    if (lock !== undefined) {
      searchKey = {
        script: lock as LumosScript,
        script_type: ScriptType.lock,
      };
      if (type != undefined && type !== 'empty') {
        searchKey.filter = {
          script: type as LumosScript,
        };
      }
    } else {
      if (type != undefined && type != 'empty') {
        searchKey = {
          script: type as LumosScript,
          script_type: ScriptType.type,
        };
      } else {
        throw new Error(`should specify either type or lock in queries, queries now: ${queries}`);
      }
    }
    const queryData = queries.data || '0x';
    const request = this.request;
    const ckbIndexerUrl = this.ckbIndexerUrl;
    return {
      collect(): CellCollectorResults {
        return {
          async *[Symbol.asyncIterator]() {
            const order = 'asc';
            const sizeLimit = 100;
            let cursor = null;
            for (;;) {
              const params = [searchKey, order, `0x${sizeLimit.toString(16)}`, cursor];
              logger.info('get_cells params', params);
              const res = await request('get_cells', params, ckbIndexerUrl);
              const liveCells = res.objects;
              cursor = res.last_cursor;
              for (const cell of liveCells) {
                if (queryData === 'any' || queryData === cell.output_data) {
                  yield {
                    cell_output: cell.output,
                    data: cell.output_data,
                    out_point: cell.out_point,
                    block_number: cell.block_number,
                  };
                }
              }
              if (liveCells.length < sizeLimit) {
                break;
              }
            }
          },
        };
      },
    };
  }

  public async request(method: string, params?: any, ckbIndexerUrl: string = this.ckbIndexerUrl): Promise<any> {
    const data = {
      id: 0,
      jsonrpc: '2.0',
      method,
      params,
    };
    const res = await axios.post(ckbIndexerUrl, data);
    if (res.status !== 200) {
      throw new Error(`indexer request failed with HTTP code ${res.status}`);
    }
    if (res.data.error !== undefined) {
      throw new Error(`indexer request rpc failed with error: ${JSON.stringify(res.data.error)}`);
    }
    return res.data.result;
  }

  /* get_cells example

search_key:
    script - Script
    scrip_type - enum, lock | type
    filter - filter cells by following conditions, all conditions are optional
        script: if search script type is lock, filter cells by type script prefix, and vice versa
        output_data_len_range: [u64; 2], filter cells by output data len range, [inclusive, exclusive]
        output_capacity_range: [u64; 2], filter cells by output capacity range, [inclusive, exclusive]
        block_range: [u64; 2], filter cells by block number range, [inclusive, exclusive]
order: enum, asc | desc
limit: result size limit
after_cursor: pagination parameter, optional

$ echo '{
  "id": 2,
  "jsonrpc": "2.0",
  "method": "get_cells",
  "params": [
      {
          "filter": {
            "script": {
              "code_hash": "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8",
              "hash_type": "type",
              "args": "0x838e79dcef9cbf819a32778c8cfcc81bb2555561"
            }
          },
          "script": {
            "code_hash": "0xc5e5dcf215925f7ef4dfaf5f4b4f105bc321c02776d6e7d52a1db3fcd9d011a4",
            "hash_type": "type",
            "args": "0x4580e3fd3a6623eb26f229239286cee63e18bcafb38bc6c5d0de5a8c587647c2"
          },
          "script_type": "type"
      },
      "asc",
      "0x1"
  ]
}' | tr -d '\n' | curl -H 'content-type: application/json' -d @- https://testnet.ckbapp.dev/indexer | jq .

 {
  "jsonrpc": "2.0",
  "result": {
    "last_cursor": "0x60c5e5dcf215925f7ef4dfaf5f4b4f105bc321c02776d6e7d52a1db3fcd9d011a4014580e3fd3a6623eb26f229239286cee63e18bcafb38bc6c5d0de5a8c587647c200000000001ad3100000000200000004",
    "objects": [
      {
        "block_number": "0x1ad310",
        "out_point": {
          "index": "0x4",
          "tx_hash": "0x6d24e50d5b46fca3f48283664453bc061744b34e03159571de4893b9640b14d5"
        },
        "output": {
          "capacity": "0x6fc23ac00",
          "lock": {
            "args": "0x838e79dcef9cbf819a32778c8cfcc81bb2555561",
            "code_hash": "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8",
            "hash_type": "type"
          },
          "type": {
            "args": "0x4580e3fd3a6623eb26f229239286cee63e18bcafb38bc6c5d0de5a8c587647c2",
            "code_hash": "0xc5e5dcf215925f7ef4dfaf5f4b4f105bc321c02776d6e7d52a1db3fcd9d011a4",
            "hash_type": "type"
          }
        },
        "output_data": "0x01000000000000000000000000000000",
        "tx_index": "0x2"
      }
    ]
  },
  "id": 2
}
*/

  public async getCells(
    searchKey: SearchKey,
    terminator: Terminator = DefaultTerminator,
    { sizeLimit = 0x100, order = Order.asc }: { sizeLimit?: number; order?: Order } = {},
  ): Promise<IndexerCell[]> {
    const infos: IndexerCell[] = [];
    let cursor = null;
    const index = 0;
    while (true) {
      const params = [searchKey, order, `0x${sizeLimit.toString(16)}`, cursor];
      const res = await this.request('get_cells', params);
      const liveCells = res.objects;
      cursor = res.last_cursor;
      logger.debug('liveCells', liveCells[liveCells.length - 1]);
      for (const cell of liveCells) {
        const indexCell: IndexerCell = {
          capacity: cell.output.capacity,
          lock: Script.fromRPC(cell.output.lock)!,
          type: Script.fromRPC(cell.output.type)!,
          outPoint: OutPoint.fromRPC(cell.out_point)!,
          data: cell.output_data,
        };
        const { stop, push } = terminator(index, indexCell);
        if (push) {
          infos.push(indexCell);
        }
        if (stop) {
          return infos;
        }
      }
      if (liveCells.length < sizeLimit) {
        break;
      }
    }
    return infos;
  }

  running(): boolean {
    return true;
  }

  start(): void {
    logger.debug('ckb indexer start');
  }

  startForever(): void {
    logger.debug('ckb indexer startForever');
  }

  stop(): void {
    logger.debug('ckb indexer stop');
  }

  subscribe(queries: QueryOptions): NodeJS.EventEmitter {
    throw new Error('unimplemented');
  }

  subscribeMedianTime(): NodeJS.EventEmitter {
    throw new Error('unimplemented');
  }
}
