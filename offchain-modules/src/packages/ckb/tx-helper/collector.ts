// import {Script} from "@ckb-lumos/base";
import {Amount, Cell, Script} from "@lay2/pw-core";
import {Indexer} from './indexer';

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
        capacity: Amount,
    ): Promise<Cell[]> {
        throw new Error("not implemented");
    }
}