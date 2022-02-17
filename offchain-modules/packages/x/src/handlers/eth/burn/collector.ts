import { generateAddress, parseAddress } from '@ckb-lumos/helpers';
import { ethers } from 'ethers';
import { ChainType } from '../../../ckb/model/asset';
import { forceBridgeRole as ForceBridgeRole } from '../../../config';
import { ForceBridgeCore } from '../../../core';
import { EthBurn } from '../../../db/entity/EthBurn';
import { logger } from '../../../utils/logger';
import { ParsedLog, Log } from '../../../xchain/eth';
import { checkBurn } from '../../../xchain/eth/check';
import Burn from './burn';
import { fromHexString, uint8ArrayToString } from '../../../utils';

class Collector extends Burn {
  protected role: ForceBridgeRole = 'collector';

  async handle(parsedLog: ParsedLog, log: Log, currentHeight: number): Promise<void> {
    await super.handle(parsedLog, log, currentHeight);

    if (!this.confirmStatus(log, currentHeight)) {
      return;
    }

    await this.notifyCkbUnlock(log, parsedLog);

    this.reportMetrics(parsedLog);
  }

  protected checkFeeEnough(fee: ethers.BigNumber): boolean {
    return fee.gte(ForceBridgeCore.config.eth.burnNervosAssetFee);
  }

  protected async notifyCkbUnlock(log: Log, parsedLog: ParsedLog): Promise<void> {
    if (!this.checkFeeEnough(parsedLog.args.fee as ethers.BigNumber)) {
      logger.warn(
        `bridge fee use paid in burn tx is too low. tx:${
          log.transactionHash
        } fee:${parsedLog.args.fee.toString()} config:${ForceBridgeCore.config.eth.burnNervosAssetFee}`,
      );
      return;
    }

    let recipient = uint8ArrayToString(fromHexString(parsedLog.args.recipient));

    try {
      checkBurn(parsedLog.args.token, parsedLog.args.amount.toString(), recipient, parsedLog.args.extraData);
    } catch (e) {
      logger.warn(e.message);
      return;
    }

    try {
      recipient = generateAddress(parseAddress(recipient));
    } catch (e) {
      logger.warn(
        `illegal ckb address in burn tx. tx:${log.transactionHash} address:${parsedLog.args.recipient} error:${e.message}`,
      );
      return;
    }

    const amount = `0x${BigInt(parsedLog.args.amount.toString()).toString(16)}`;

    await this.ethDb.createCollectorCkbUnlock([
      {
        id: EthBurn.primaryKey(log.logIndex, log.transactionHash),
        burnTxHash: log.transactionHash,
        xchain: ChainType.ETH,
        udtExtraData: parsedLog.args.extraData,
        assetIdent: parsedLog.args.assetId,
        amount,
        recipientAddress: recipient,
      },
    ]);
  }
}

export default Collector;
