import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { stringToUint8Array } from '@force-bridge/x/dist/utils';
import { logger } from '@force-bridge/x/dist/utils/logger';
import { abi } from '@force-bridge/x/dist/xchain/eth/abi/AssetManager.json';
import { checkBurn } from '@force-bridge/x/dist/xchain/eth/check';
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

    try {
      checkBurn(payload.asset, payload.amount, payload.recipient, '0x');
    } catch (e) {
      logger.error(e.message);
      throw e;
    }

    const contract = new ethers.Contract(
      ForceBridgeCore.config.eth.assetManagerContractAddress,
      abi,
      new ethers.providers.JsonRpcProvider(ForceBridgeCore.config.eth.rpcUrl),
    );

    const tx = await contract.populateTransaction.burn(
      payload.asset,
      ethers.utils.parseUnits(payload.amount, 0),
      stringToUint8Array(payload.recipient),
      '0x',
      {
        value: this.bridgeFee(),
      },
    );

    return {
      network: 'Ethereum',
      rawTransaction: tx,
    };
  }

  protected bridgeFee(): string {
    return ForceBridgeCore.config.eth.burnNervosAssetFee;
  }
}

export default Eth;
