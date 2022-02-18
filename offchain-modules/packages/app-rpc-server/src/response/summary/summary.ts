import { LockRecord, UnlockRecord } from '@force-bridge/x/dist/db/model';
import { TransactionSummaryWithStatus, TransactionSummary, BridgeTransactionStatus } from '../../types/apiv1';

abstract class SummaryResponse {
  protected abstract responseLock(record: LockRecord): TransactionSummary;
  protected abstract responseUnlock(record: UnlockRecord): TransactionSummary;

  response(record: LockRecord | UnlockRecord): TransactionSummaryWithStatus {
    let summary: TransactionSummary;
    if ('lock_hash' in record) {
      summary = this.responseLock(record);
    } else if ('burn_hash' in record) {
      summary = this.responseUnlock(record);
    } else {
      throw new Error(`the params record ${JSON.stringify(record, null, 2)} is unexpect`);
    }

    return this.extendsStatus(record, summary);
  }

  protected extendsStatus(
    record: LockRecord | UnlockRecord,
    summary: TransactionSummary,
  ): TransactionSummaryWithStatus {
    switch (record.status) {
      case null:
      case 'todo':
      case 'pending':
        return { txSummary: summary.txSummary, status: BridgeTransactionStatus.Pending };
      case 'success':
        return { txSummary: summary.txSummary, status: BridgeTransactionStatus.Successful };
      case 'error':
        return {
          txSummary: summary.txSummary,
          message: record.message,
          status: BridgeTransactionStatus.Failed,
        };
      default:
        throw new Error(`${record.status} which mean the tx status is unexpect`);
    }
  }
}

export default SummaryResponse;
