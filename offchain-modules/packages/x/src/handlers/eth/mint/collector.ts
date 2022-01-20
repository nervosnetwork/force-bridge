import { ethers } from 'ethers';
import { forceBridgeRole as ForceBridgeRole } from '../../../config';
import { CollectorEthMint } from '../../../db/entity/EthMint';
import { logger } from '../../../utils/logger';
import { ParsedLog, Log } from '../../../xchain/eth';
import Mint from './mint';

class Collector extends Mint {
  protected role: ForceBridgeRole = 'collector';

  async handle(log: Log, parsedLog: ParsedLog): Promise<void> {
    await super.handle(log, parsedLog);
    const record = await this.ethDb.getCEthMintRecordByCkbTx(parsedLog.args.lockId);

    if (!record) {
      logger.error(`receive mint log but no record in db. eth tx: ${log.transactionHash}`);
      return;
    }

    await this.updateCollectorMint(record, log);

    this.reportMetrics(parsedLog);
  }

  protected async updateCollectorMint(record: CollectorEthMint, log: Log): Promise<void> {
    await this.initBlock(log.blockHash);

    record.blockNumber = log.blockNumber;
    record.blockTimestamp = (this.block as ethers.providers.Block).timestamp;
    record.status = 'success';

    await this.ethDb.saveCollectorEthMints([record]);
  }
}

export default Collector;
