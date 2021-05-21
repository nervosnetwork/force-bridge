import { Script as LumosScript } from '@ckb-lumos/base';
import { Amount, Script } from '@lay2/pw-core';
import { logger } from '../../utils/logger';
import { CkbIndexer, IndexerCell, ScriptType, SearchKey, Terminator } from './indexer';

export abstract class Collector {
  abstract getCellsByLockscriptAndCapacity(lockscript: Script, capacity: Amount): Promise<IndexerCell[]>;
}

export class IndexerCollector extends Collector {
  constructor(public indexer: CkbIndexer) {
    super();
  }

  async getCellsByLockscriptAndCapacity(lockscript: Script, needCapacity: Amount): Promise<IndexerCell[]> {
    let accCapacity = Amount.ZERO;
    const terminator: Terminator = (index, c) => {
      const cell = c;
      if (accCapacity.gte(needCapacity)) {
        return { stop: true, push: false };
      }
      if (cell.data.length / 2 - 1 > 0 || cell.type !== undefined) {
        return { stop: false, push: false };
      } else {
        accCapacity = accCapacity.add(new Amount(cell.capacity, 0));
        return { stop: false, push: true };
      }
    };
    const searchKey = {
      script: lockscript.serializeJson() as LumosScript,
      script_type: ScriptType.lock,
    };
    const cells = await this.indexer.getCells(searchKey, terminator);
    return cells;
  }

  async collectSudtByAmount(searchKey: SearchKey, amount: Amount): Promise<IndexerCell[]> {
    let balance = Amount.ZERO;
    const terminator: Terminator = (index, c) => {
      const cell = c;
      if (balance.gte(amount)) {
        return { stop: true, push: false };
      } else {
        const cellAmount = Amount.fromUInt128LE(cell.data);
        balance = balance.add(cellAmount);
        return { stop: false, push: true };
      }
    };
    const cells = await this.indexer.getCells(searchKey, terminator);
    return cells;
  }

  async getSUDTBalance(sudtType: Script, userLock: Script): Promise<Amount> {
    const searchKey = {
      script: userLock.serializeJson() as LumosScript,
      script_type: ScriptType.lock,
      filter: {
        script: sudtType.serializeJson() as LumosScript,
      },
    };
    const cells = await this.indexer.getCells(searchKey);
    let balance = Amount.ZERO;
    cells.forEach((cell) => {
      logger.debug('cell.data:', cell.data);
      const amount = Amount.fromUInt128LE(cell.data);
      balance = balance.add(amount);
    });
    return balance;
  }

  async getCellsByLockscriptAndCapacityWhenBurn(
    lockscript: Script,
    recipientTypeCodeHash: string,
    needCapacity: Amount,
  ): Promise<IndexerCell[]> {
    let accCapacity = Amount.ZERO;
    const terminator: Terminator = (index, c) => {
      const cell = c;
      if (accCapacity.gte(needCapacity)) {
        return { stop: true, push: false };
      }
      if (cell.type !== undefined && cell.type.codeHash == recipientTypeCodeHash) {
        accCapacity = accCapacity.add(new Amount(cell.capacity, 0));
        return { stop: false, push: true };
      }
      if (cell.data.length / 2 - 1 > 0 || cell.type !== undefined) {
        return { stop: false, push: false };
      } else {
        accCapacity = accCapacity.add(new Amount(cell.capacity, 0));
        return { stop: false, push: true };
      }
    };
    const searchKey = {
      script: lockscript.serializeJson() as LumosScript,
      script_type: ScriptType.lock,
    };
    const cells = await this.indexer.getCells(searchKey, terminator);
    return cells;
  }
}
