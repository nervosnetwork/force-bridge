import { parseAddress } from '@ckb-lumos/helpers';
import { ethers } from 'ethers';
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

  protected checkETHAddress(address: string): void {
    if (!ethers.utils.isAddress(address) || address.substr(0, 2).toLowerCase() != '0x') {
      throw new Error('invalid eth address');
    }
  }
}

export default Burn;
