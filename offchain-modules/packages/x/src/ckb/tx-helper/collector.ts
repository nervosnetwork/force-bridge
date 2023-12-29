import { Script, utils, Cell } from '@ckb-lumos/base';
import { SearchKey, ScriptType } from '@ckb-lumos/ckb-indexer/src/type';
import { Indexer as CkbIndexer } from '@ckb-lumos/lumos';
import { logger } from '../../utils/logger';
import { Terminator } from './indexer';

export abstract class Collector {
  abstract getCellsByLockscriptAndCapacity(lockscript: Script, capacity: bigint): Promise<Cell[]>;
}

export class IndexerCollector extends Collector {
  constructor(public indexer: CkbIndexer) {
    super();
  }

  async getCellsByLockscriptAndCapacity(lockscript: Script, needCapacity: bigint): Promise<Cell[]> {
    let accCapacity = 0n;
    const terminator: Terminator = (index, c) => {
      const cell = c;
      if (accCapacity >= needCapacity) {
        return { stop: true, push: false };
      }
      if (cell.data.length / 2 - 1 > 0 || cell.cellOutput.type) {
        return { stop: false, push: false };
      } else {
        accCapacity += BigInt(cell.cellOutput.capacity);
        return { stop: false, push: true };
      }
    };
    const searchKey = {
      script: lockscript,
      scriptType: 'lock' as ScriptType,
    };
    const cells = await this.indexer.getCells(searchKey, terminator);
    return cells.objects;
  }

  async collectSudtByAmount(searchKey: SearchKey, amount: bigint): Promise<Cell[]> {
    let balance = 0n;
    const terminator: Terminator = (index, c) => {
      const cell = c;
      if (balance >= amount) {
        return { stop: true, push: false };
      } else {
        const cellAmount = utils.readBigUInt128LE(cell.data);
        balance += cellAmount;
        return { stop: false, push: true };
      }
    };
    const cells = await this.indexer.getCells(searchKey, terminator);
    return cells.objects;
  }

  async getBalance(lock: Script): Promise<bigint> {
    const searchKey = {
      script: lock,
      scriptType: 'lock' as ScriptType,
    };
    const cells = await this.indexer.getCells(searchKey);
    return cells.objects.reduce((acc, cur) => (acc += BigInt(cur.cellOutput.capacity)), 0n);
  }

  async getSUDTBalance(sudtType: Script, userLock: Script): Promise<bigint> {
    const searchKey = {
      script: userLock,
      scriptType: 'lock' as ScriptType,
      filter: {
        script: sudtType,
      },
    };
    const cells = await this.indexer.getCells(searchKey);
    return cells.objects.reduce((acc, cur) => {
      logger.debug('cell.data:', cur.data);
      return (acc += utils.readBigUInt128LE(cur.data));
    }, 0n);
  }

  async getCellsByLockscriptAndCapacityWhenBurn(
    lockscript: Script,
    recipientTypeCodeHash: string,
    needCapacity: bigint,
  ): Promise<Cell[]> {
    let accCapacity = 0n;
    const terminator: Terminator = (index, c) => {
      const cell = c;
      if (accCapacity >= needCapacity) {
        return { stop: true, push: false };
      }
      if (cell.cellOutput.type && cell.cellOutput.type.codeHash === recipientTypeCodeHash) {
        accCapacity += BigInt(cell.cellOutput.capacity);
        return { stop: false, push: true };
      }
      if (cell.data.length / 2 - 1 > 0 || cell.cellOutput.type !== undefined) {
        return { stop: false, push: false };
      } else {
        accCapacity += BigInt(cell.cellOutput.capacity);
        return { stop: false, push: true };
      }
    };
    const searchKey = {
      script: lockscript,
      scriptType: 'lock' as ScriptType,
    };
    const cells = await this.indexer.getCells(searchKey, terminator);
    return cells.objects;
  }
}
