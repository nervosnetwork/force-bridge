import { forceBridgeRole as ForceBridgeRole } from '../../../config';
import { Log, ParsedLog } from '../../../xchain/eth';
import Burn from './burn';

class Verifier extends Burn {
  protected role: ForceBridgeRole = 'verifier';

  async handle(parsedLog: ParsedLog, log: Log, currentHeight: number): Promise<void> {
    await super.handle(parsedLog, log, currentHeight);

    this.reportMetrics(parsedLog);
  }
}

export default Verifier;
