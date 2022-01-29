import { ethers } from 'ethers';
import { forceBridgeRole as ForceBridgeRole } from '../../../config';
import { ForceBridgeCore } from '../../../core';
import { EthDb } from '../../../db';
import { EthBurn } from '../../../db/entity/EthBurn';
import { TxConfirmStatus } from '../../../db/model';
import { BridgeMetricSingleton } from '../../../metric/bridge-metric';
import { logger } from '../../../utils/logger';
import { EthChain, ParsedLog, Log } from '../../../xchain/eth';

abstract class Burn {
  protected ethDb: EthDb;
  protected ethChain: EthChain;
  protected abstract role: ForceBridgeRole;
  protected block: ethers.providers.Block;

  constructor(ethDb: EthDb, ethChain: EthChain) {
    this.ethDb = ethDb;
    this.ethChain = ethChain;
  }

  async handle(parsedLog: ParsedLog, log: Log, currentHeight: number): Promise<void> {
    logger.info(
      `EthHandler watchBurnEvents receiveLog blockHeight:${log.blockNumber} blockHash:${log.blockHash} txHash:${
        log.transactionHash
      } amount:${parsedLog.args.amount.toString()} asset:${parsedLog.args.token} recipientLockscript:${
        parsedLog.args.recipient
      } sudtExtraData:${parsedLog.args.extraData} sender:${parsedLog.args.from}, confirmedNumber: ${this.confirmNumber(
        log,
        currentHeight,
      )}, confirmStatus: ${this.confirmStatus(log, currentHeight)}`,
    );

    const record = await this.getBurnRecord(log, parsedLog);
    await this.updateBurnRecord(record, parsedLog, log, currentHeight);
  }

  protected reportMetrics(parsedLog: ParsedLog): void {
    BridgeMetricSingleton.getInstance(this.role).addBridgeTxMetrics('eth_burn', 'success');
    BridgeMetricSingleton.getInstance(this.role).addBridgeTokenMetrics('eth_burn', [
      {
        amount: parsedLog.args.amount.toNumber(),
        token: parsedLog.args.token,
      },
    ]);
  }

  protected async initBolck(hash: string): Promise<void> {
    if (!this.block) {
      this.block = await this.ethChain.getBlock(hash);
    }
  }

  async getBurnRecord(log: Log, parsedLog: ParsedLog): Promise<EthBurn> {
    let record = await this.ethDb.getBurnRecord(log.logIndex, log.transactionHash);

    if (record == undefined) {
      await this.initBolck(log.blockHash);

      record = new EthBurn();
      record.burnTxHash = log.transactionHash;
      record.amount = parsedLog.args.amount.toString();
      record.xchainTokenId = parsedLog.args.token;
      record.recipient = parsedLog.args.recipient;
      record.nervosAssetId = parsedLog.args.assetId;
      record.udtExtraData = parsedLog.args.extraData;
      record.sender = parsedLog.args.from;
      record.uniqueId = EthBurn.primaryKey(log.logIndex, log.transactionHash);
      record.bridgeFee = parsedLog.args.fee.toString();
      record.blockNumber = log.blockNumber;
      record.blockTimestamp = (this.block as ethers.providers.Block).timestamp;
      record.blockHash = log.blockHash;
    }

    return record;
  }

  async updateBurnRecord(record: EthBurn, parsedLog: ParsedLog, log: Log, currentHeight: number): Promise<EthBurn> {
    if (!this.block) {
      this.block = await this.ethChain.getBlock(log.blockHash);
    }

    if (record.confirmNumber < this.confirmNumber(log, currentHeight)) {
      record.confirmNumber = this.confirmNumber(log, currentHeight);
    }

    record.confirmStatus = this.confirmStatus(log, currentHeight);

    await this.ethDb.saveEthBurn(record);

    logger.info(
      `update burn record ${log.transactionHash} status, confirmed number: ${this.confirmNumber(
        log,
        currentHeight,
      )} status ${this.confirmStatus(log, currentHeight)}`,
    );

    return record;
  }

  protected confirmNumber(log: Log, currentHeight: number): number {
    return currentHeight - log.blockNumber;
  }

  protected confirmStatus(log: Log, currentHeight: number): TxConfirmStatus {
    if (this.confirmNumber(log, currentHeight) >= ForceBridgeCore.config.eth.confirmNumber) {
      return 'confirmed';
    }

    return 'unconfirmed';
  }
}

export default Burn;
