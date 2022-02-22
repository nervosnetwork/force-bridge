import { ethers } from 'ethers';
import { forceBridgeRole as ForceBridgeRole } from '../../../config';
import { EthDb, CkbDb } from '../../../db';
import { IEthMint } from '../../../db/model';
import { BridgeMetricSingleton } from '../../../metric/bridge-metric';
import { ParsedLog, Log, EthChain } from '../../../xchain/eth';

abstract class Mint {
  protected ethDb: EthDb;
  protected ckbDb: CkbDb;
  protected ethChain: EthChain;
  protected block: ethers.providers.Block | undefined = undefined;
  protected abstract role: ForceBridgeRole;

  constructor(ethDb: EthDb, ckbDb: CkbDb, ethChain: EthChain) {
    this.ethDb = ethDb;
    this.ckbDb = ckbDb;
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

  protected async getMintRecord(parsedLog: ParsedLog, log: Log): Promise<IEthMint> {
    const record = await this.ethDb.getEthMint(parsedLog.args.lockId);

    if (record == undefined) {
      await this.initBlock(log.blockHash);

      const amount = `0x${BigInt(parsedLog.args.amount.toString()).toString(16)}`;

      const iEthMint = {
        ckbTxHash: parsedLog.args.lockId,
        erc20TokenAddress: parsedLog.args.token,
        nervosAssetId: parsedLog.args.assetId,
        amount,
        recipientAddress: parsedLog.args.to,
        blockNumber: log.blockNumber,
        blockTimestamp: (this.block as ethers.providers.Block).timestamp,
        ethTxHash: log.transactionHash,
      };

      await this.ethDb.createEthMint([iEthMint]);
      return iEthMint;
    }

    return record as IEthMint;
  }

  protected isCkb(assetId: string): boolean {
    return assetId == '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
  }

  async saveBridgeFee(parsedLog: ParsedLog, record: IEthMint): Promise<void> {
    if (!this.isCkb(parsedLog.args.assetId)) {
      return;
    }

    const ckbRecord = await this.ethDb.getCkbLock(parsedLog.args.lockId);
    if (ckbRecord != undefined) {
      const bridgeFee = ethers.BigNumber.from(ckbRecord.amount).sub(ethers.BigNumber.from(record.amount)).toString();

      await this.ckbDb.updateLockAmountAndBridgeFee([
        {
          ckbTxHash: ckbRecord.ckbTxHash,
          amount: record.amount,
          bridgeFee,
        },
      ]);
    }
  }
}

export default Mint;
