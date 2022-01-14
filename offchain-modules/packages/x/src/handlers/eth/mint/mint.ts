import { ethers } from 'ethers';
import { forceBridgeRole as ForceBridgeRole } from '../../../config';
import { EthDb } from '../../../db';
import { EthMint } from '../../../db/entity/EthMint';
import { BridgeMetricSingleton } from '../../../metric/bridge-metric';
import { ParsedLog, Log, EthChain } from '../../../xchain/eth';

abstract class Mint {
  protected ethDb: EthDb;
  protected ethChain: EthChain;
  protected block: ethers.providers.Block | undefined = undefined;
  protected abstract role: ForceBridgeRole;

  constructor(ethDb: EthDb, ethChain: EthChain) {
    this.ethDb = ethDb;
    this.ethChain = ethChain;
  }

  async handle(log: Log, parsedLog: ParsedLog): Promise<void> {
    const record = await this.getMintRecord(parsedLog);
    await this.updateMintRecord(log, record);
    await this.saveBridgeFee(parsedLog, record);
  }

  protected reportMetrics(parsedLog: ParsedLog): void {
    BridgeMetricSingleton.getInstance(this.role).addBridgeTokenMetrics('eth_mint', [
      {
        amount: parsedLog.args.amount.toNumber(),
        token: parsedLog.args.token,
      },
    ]);
  }

  protected async getMintRecord(parsedLog: ParsedLog): Promise<EthMint> {
    let record = await this.ethDb.getEthMint(parsedLog.args.lockId);

    if (record == undefined) {
      record = new EthMint();
      record.ckbTxHash = parsedLog.args.lockId;
      record.nervosAssetId = parsedLog.args.assetId;
      record.erc20TokenAddress = parsedLog.args.token;
      record.amount = parsedLog.args.amount;
      record.recipientAddress = parsedLog.args.to;
    }

    return record;
  }

  protected isCkb(assetId: string): boolean {
    return assetId == '0x0000000000000000000000000000000000000000000000000000000000000000';
  }

  async updateMintRecord(log: Log, record: EthMint): Promise<void> {
    if (!this.block) {
      this.block = await this.ethChain.getBlock(log.blockHash);
    }

    record.blockTimestamp = this.block.timestamp;
    record.blockNumber = this.block.number;

    await this.ethDb.saveEthMint(record);
  }

  async saveBridgeFee(parsedLog: ParsedLog, record: EthMint): Promise<void> {
    if (!this.isCkb(parsedLog.args.assetId())) {
      return;
    }

    const ckbRecord = await this.ethDb.getCkbLock(parsedLog.args.lockId);
    if (ckbRecord != undefined) {
      ckbRecord.bridgeFee = ethers.BigNumber.from(record.amount)
        .sub(ethers.BigNumber.from(ckbRecord.amount))
        .toString();
      await this.ethDb.saveCkbLock(ckbRecord);
    }
  }
}

export default Mint;
