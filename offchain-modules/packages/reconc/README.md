# @force-bridge/reconc

reconc module providing a commons interface `Reconciliation` for checking if `bridge from` and `bridge to` are balanced

## Example

```ts
import { Reconciler, Reconciliation } from '@force-bridge/reconc';

class EthLockReconciler implements Reconciler {
  async getFromRecordsByOnChainState(): Promise<FromRecord[]> {
    return contractHelper.getFromRecords();
  }

  async getToRecordsByLocalState(): Promise<ToRecord[]> {
    return db.getMintRecords();
  }

  async fetchReconciliation(): Promise<Reconciliation> {
    const [from, to] = await Promise.all([this.getFromRecordsByOnChainState(), this.getToRecordsByLocalState()]);
    return new Reconciliation(from, to);
  }
}
```
