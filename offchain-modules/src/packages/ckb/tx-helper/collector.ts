import { Script as LumosScript } from '@ckb-lumos/base';
import { Amount, Script } from '@lay2/pw-core';
import { CkbIndexer, IndexerCell, ScriptType, Terminator } from './indexer';

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
        accCapacity = accCapacity.add(Amount.fromUInt128LE(cell.capacity));
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
