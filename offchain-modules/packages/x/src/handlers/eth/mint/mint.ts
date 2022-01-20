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
    const record = await this.getMintRecord(parsedLog, log);
    await this.saveBridgeFee(parsedLog, record);
  }

  protected async initBlock(hash: string): Promise<void> {
    if (!this.block) {
      this.block = await this.ethChain.getBlock(hash);
    }
  }

  protected reportMetrics(parsedLog: ParsedLog): void {
    BridgeMetricSingleton.getInstance(this.role).addBridgeTokenMetrics('eth_mint', [
      {
        amount: parsedLog.args.amount.toNumber(),
        token: parsedLog.args.token,
      },
    ]);
  }

  protected async getMintRecord(parsedLog: ParsedLog, log: Log): Promise<EthMint> {
    let record = await this.ethDb.getEthMint(parsedLog.args.lockId);

    if (record == undefined) {
      await this.initBlock(log.blockHash);

      record = new EthMint();
      record.ckbTxHash = parsedLog.args.lockId;
      record.nervosAssetId = parsedLog.args.assetId;
      record.erc20TokenAddress = parsedLog.args.token;
      record.amount = parsedLog.args.amount;
      record.recipientAddress = parsedLog.args.to;
      record.blockTimestamp = (this.block as ethers.providers.Block).timestamp;
      record.blockNumber = log.blockNumber;

      await this.ethDb.saveEthMint(record);
    }

    return record;
  }

  protected isCkb(assetId: string): boolean {
    return assetId == '0x0000000000000000000000000000000000000000000000000000000000000000';
  }

  async saveBridgeFee(parsedLog: ParsedLog, record: EthMint): Promise<void> {
    if (!this.isCkb(parsedLog.args.assetId())) {
      return;
    }

    const ckbRecord = await this.ethDb.getCkbLock(parsedLog.args.lockId);
    if (ckbRecord != undefined) {
      ckbRecord.bridgeFee = ethers.BigNumber.from(ckbRecord.amount)
        .sub(ethers.BigNumber.from(record.amount))
        .toString();

      ckbRecord.amount = record.amount;
      await this.ethDb.saveCkbLock(ckbRecord);
    }
  }
}

export default Mint;
