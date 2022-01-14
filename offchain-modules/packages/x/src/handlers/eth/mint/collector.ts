import { forceBridgeRole as ForceBridgeRole } from '../../../config';
import { CollectorEthMint } from '../../../db/entity/EthMint';
import { ParsedLog, Log } from '../../../xchain/eth';
import Mint from './mint';

class Collector extends Mint {
  protected role: ForceBridgeRole = 'collector';

  async handle(log: Log, parsedLog: ParsedLog): Promise<void> {
    await super.handle(log, parsedLog);
    const record = await this.ethDb.getCEthMintRecordByCkbTx(parsedLog.args.lockId);

    if (!record) {
      return;
    }

    await this.saveCollectorMint(record, log);

    this.reportMetrics(parsedLog);
  }

  protected async saveCollectorMint(record: CollectorEthMint, log: Log): Promise<void> {
    if (log.blockNumber <= record.blockNumber) {
      return;
    }

    if (!this.block) {
      this.block = await this.ethChain.getBlock(log.blockHash);
    }

    record.blockNumber = this.block.number;
    record.blockTimestamp = this.block.timestamp;
    record.status = 'success';

    await this.ethDb.saveCollectorEthMint([record]);
  }
}

export default Collector;
