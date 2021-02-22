import axios from 'axios';
import { CollectorOptions,Collector, SUDTCollector, Cell, Address, Amount, AmountUnit, OutPoint, SUDT } from '@lay2/pw-core';

export class CkbIndexer {
    constructor(public endpoint: string) {
        this.endpoint = endpoint;
    }

    async getCells(): Promise<Cell[]> {
        throw new Error("not implemented");
    }

    async getCellsByLockscript(): Promise<Cell[]> {
        throw new Error("not implemented");
    }
}
