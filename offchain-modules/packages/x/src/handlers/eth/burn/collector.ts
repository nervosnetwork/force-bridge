import { generateAddress, parseAddress } from '@ckb-lumos/helpers';
import { ChainType } from '../../../ckb/model/asset';
import { forceBridgeRole as ForceBridgeRole } from '../../../config';
import { ForceBridgeCore } from '../../../core';
import { EthBurn } from '../../../db/entity/EthBurn';
import { ICkbUnlock } from '../../../db/model';
import { logger } from '../../../utils/logger';
import { ParsedLog, Log } from '../../../xchain/eth';
import Burn from './burn';

class Collector extends Burn {
  protected role: ForceBridgeRole = 'collector';

  async handle(parsedLog: ParsedLog, log: Log, currentHeight: number): Promise<void> {
    await super.handle(parsedLog, log, currentHeight);

    await this.notifyCkbUnlock(log, parsedLog, currentHeight);

    this.reportMetrics(parsedLog);
  }

  protected checkFeeEnough(fee: number): boolean {
    return fee >= Number(ForceBridgeCore.config.eth.burnNervosAssetFee);
  }

  protected checkMinBurnAmount(amount: number): boolean {
    return amount >= ForceBridgeCore.config.eth.minBurnAmount;
  }

  protected async notifyCkbUnlock(log: Log, parsedLog: ParsedLog, currentHeight: number): Promise<void> {
    if (!this.checkFeeEnough(parsedLog.args.fee.toNumber())) {
      logger.warn(
        `bridge fee use paid in burn tx is too low. tx:${
          log.transactionHash
        } fee:${parsedLog.args.fee.toString()} config:${ForceBridgeCore.config.eth.burnNervosAssetFee}`,
      );
      return;
    }

    let recipient: string;
    try {
      recipient = generateAddress(parseAddress(parsedLog.args.recipient));
    } catch (e) {
      logger.warn(
        `illegal ckb address in burn tx. tx:${log.transactionHash} address:${parsedLog.args.recipient} error:${e.message}`,
      );
      return;
    }

    if (!this.checkMinBurnAmount(parsedLog.args.amount.toNumber())) {
      logger.warn(
        `token amount to burn is too low. tx:${log.transactionHash} amount:${parsedLog.args.amount.toString()} config:${
          ForceBridgeCore.config.eth.minBurnAmount
        }`,
      );
      return;
    }

    if (this.confirmStatus(log, currentHeight) == 'confirmed') {
      await this.initBolck(log.blockHash);
      const unlock: ICkbUnlock = {
        id: EthBurn.primaryKey(log.logIndex, log.transactionHash),
        burnTxHash: log.transactionHash,
        xchain: ChainType.ETH,
        udtExtraData: parsedLog.args.extraData,
        assetIdent: parsedLog.args.assetId,
        amount: parsedLog.args.amount,
        recipientAddress: recipient,
        blockTimestamp: 0,
        blockNumber: 0,
        unlockTxHash: '',
        extraData: parsedLog.args.extraData,
      };

      await this.ethDb.createCollectorCkbUnlock([unlock]);
    }
  }
}

export default Collector;
