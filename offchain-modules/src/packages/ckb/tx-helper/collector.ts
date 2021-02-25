// import {Script} from "@ckb-lumos/base";
import {Amount, Cell, Script} from "@lay2/pw-core";
import {Indexer, ScriptType, Terminator} from './indexer';

export abstract class Collector {
    abstract getCellsByLockscriptAndCapacity(
        lockscript: Script,
        capacity: Amount,
    ): Promise<Cell[]>;
}

export class IndexerCollector extends Collector {
    constructor(public indexer: Indexer) {
        super()
    }

    async getCellsByLockscriptAndCapacity(
        lockscript: Script,
        needCapacity: Amount,
    ): Promise<Cell[]> {
        let accCapacity = Amount.ZERO;
        const terminator: Terminator = (index, cell) => {
            if(accCapacity.gte(needCapacity)) {
                return { stop: true, push: false };
            }
            if(cell.getData().length / 2 - 1 > 0 || cell.type !== undefined ) {
                return { stop: false, push: false };
            } else {
                accCapacity = accCapacity.add(cell.capacity);
                return { stop: false, push: true };
            }
        };
        const searchKey = {
            script: lockscript.serializeJson(),
            script_type: ScriptType.lock,
        }
        const cells = await this.indexer.getCells(searchKey, terminator);
        return cells;
    }
}