import { parseAddress } from '@ckb-lumos/helpers';
import { NetworkTypes } from '../../types';
import { GenerateBridgeNervosToXchainBurnTxPayload, GenerateTransactionResponse } from '../../types/apiv1';

abstract class Burn {
  abstract handle<T extends NetworkTypes>(
    payload: GenerateBridgeNervosToXchainBurnTxPayload,
  ): Promise<GenerateTransactionResponse<T>>;

  protected checkCKBAddress(address: string): void {
    try {
      parseAddress(address);
    } catch (e) {
      throw new Error('invalid ckb address');
    }
  }
}

export default Burn;
