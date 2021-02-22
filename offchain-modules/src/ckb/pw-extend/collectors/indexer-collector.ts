import axios from 'axios';
import { CollectorOptions,Collector, SUDTCollector, Cell, Address, Amount, AmountUnit, OutPoint, SUDT } from '@lay2/pw-core';


export class IndexerCollector extends Collector {
    constructor() {
        super();
    }

    collect(address: Address, options?: CollectorOptions): Promise<Cell[]> {
        return Promise.resolve([]);
    }

    getBalance(address: Address): Promise<Amount> {
        return Promise.resolve(undefined);
    }
}
