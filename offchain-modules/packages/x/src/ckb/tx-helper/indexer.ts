import { Script as LumosScript } from '@ckb-lumos/base';
import { RPC } from '@ckb-lumos/rpc';
import {
  CollectorOptions,
  Collector,
  SUDTCollector,
  Cell,
  Address,
  Amount,
  AmountUnit,
  OutPoint,
  Script,
  SUDT,
} from '@lay2/pw-core';
import axios from 'axios';
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

export interface SearchKey {
  script: LumosScript;
  script_type: ScriptType;
  args_len?: string;
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

export class CkbIndexer {
  private ckbRpc: RPC;

  constructor(public ckbRpcUrl: string, public ckbIndexerUrl: string) {
    this.ckbRpc = new RPC(ckbRpcUrl);
  }

  async waitUntilSync(): Promise<void> {
    const rpcTipNumber = parseInt((await this.ckbRpc.get_tip_header()).number, 16);
    logger.debug('rpcTipNumber', rpcTipNumber);
    const index = 0;
    while (true) {
      const indexerTipNumber = parseInt((await this.request('get_tip')).block_number, 16);
      logger.debug('indexerTipNumber', indexerTipNumber);
      if (indexerTipNumber >= rpcTipNumber) {
        return;
      }
      logger.debug(`wait until indexer sync. index: ${index}`);
      await asyncSleep(1000);
    }
  }

  async request(method: string, params?: any): Promise<any> {
    const data = {
      id: 0,
      jsonrpc: '2.0',
      method,
      params,
    };
    const res = await axios.post(this.ckbIndexerUrl, data);
    logger.debug('indexer request', { method, params, result: res.data });
    if (res.status !== 200) {
      throw new Error(`indexer request failed with HTTP code ${res.status}`);
    }
    if (res.data.error !== undefined) {
      throw new Error(`indexer request rpc failed with error: ${JSON.stringify(res.data.error)}`);
    }
    return res.data.result;
  }

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
        const indexCell = {
          capacity: cell.output.capacity,
          lock: Script.fromRPC(cell.output.lock),
          type: Script.fromRPC(cell.output.type),
          outPoint: OutPoint.fromRPC(cell.out_point),
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
}
