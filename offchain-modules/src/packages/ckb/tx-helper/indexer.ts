import axios from 'axios';
import {
  CollectorOptions,
  HashType,
  Collector,
  SUDTCollector,
  Cell,
  Address,
  Amount,
  AmountUnit,
  OutPoint,
  SUDT,
} from '@lay2/pw-core';
import { logger } from '../../utils/logger';
import { Script } from '@ckb-lumos/base';
import { RPC } from '@ckb-lumos/rpc';
import { asyncSleep } from '../../utils';

export enum ScriptType {
  type = 'type',
  lock = 'lock',
}

export enum Order {
  asc = 'asc',
  desc = 'desc',
}

export interface SearchKey {
  script: Script;
  script_type: ScriptType;
  args_len?: string;
}

export interface TerminatorResult {
  stop: boolean;
  push: boolean;
}

export declare type Terminator = (index: number, cell: Cell) => TerminatorResult;

const DefaultTerminator: Terminator = (_index, _cell) => {
  return { stop: false, push: true };
};

export class CkbIndexer {
  private ckbRpc: RPC;

  constructor(public ckbIndexerUrl: string, public ckbRpcUrl: string) {
    this.ckbRpc = new RPC(ckbRpcUrl);
  }

  async waitUntilSync(): Promise<void> {
    const rpcTipNumber = parseInt((await this.ckbRpc.get_tip_header()).number, 16);
    logger.debug('rpcTipNumber', rpcTipNumber);
    let index = 0;
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
  ): Promise<Cell[]> {
    const infos: Cell[] = [];
    let cursor = null;
    let index = 0;
    const params = [searchKey, order, `${sizeLimit.toString(16)}`, cursor];
    while (true) {
      const res = await this.request('get_cells', params);
      let liveCells = res.objects;
      cursor = res.lastCursor;
      logger.debug('liveCells', liveCells[liveCells.length - 1]);
      for (const cell of liveCells) {
        const { stop, push } = terminator(index, cell);
        if (push) {
          infos.push(cell);
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
