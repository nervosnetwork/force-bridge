import { LogDescription } from 'ethers/lib/utils';
import { forceBridgeRole as ForceBridgeRole } from '../../../config';
import { Log } from '../../../xchain/eth';
import Mint from './mint';

class Verifier extends Mint {
  protected role: ForceBridgeRole = 'verifier';

  async handle(log: Log, parsedLog: LogDescription): Promise<void> {
    await super.handle(log, parsedLog);

    this.reportMetrics(parsedLog);
  }
}

export default Verifier;
