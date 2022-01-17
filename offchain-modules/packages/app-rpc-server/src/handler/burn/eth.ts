import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { stringToUint8Array } from '@force-bridge/x/dist/utils';
import { logger } from '@force-bridge/x/dist/utils/logger';
import { abi } from '@force-bridge/x/dist/xchain/eth/abi/AssetManager.json';
import ethers from 'ethers';
import { GenerateBridgeNervosToXchainBurnTxPayload, GenerateTransactionResponse } from '../../types/apiv1';
import { NetworkBase } from '../../types/network';
import Burn from './burn';

class Eth extends Burn {
  async handle<T extends Required<NetworkBase>>(
    payload: GenerateBridgeNervosToXchainBurnTxPayload,
  ): Promise<GenerateTransactionResponse<T>> {
    logger.info(`generateBridgeOutEtherumTransaction, payload: ${JSON.stringify(payload)}`);

    this.checkCKBAddress(payload.recipient);

    const contract = new ethers.Contract(
      ForceBridgeCore.config.eth.assetManagerContractAddress,
      abi,
      new ethers.providers.JsonRpcBatchProvider(ForceBridgeCore.config.eth.rpcUrl),
    );

    const amount = ethers.utils.parseUnits(payload.amount);
    const recipient = stringToUint8Array(payload.recipient);
    const extraData = '0x';

    const tx = await contract.populateTransaction.burn(payload.asset, amount, recipient, extraData);

    return {
      network: 'Ethereum',
      rawTransaction: tx,
    };
  }
}

export default Eth;
