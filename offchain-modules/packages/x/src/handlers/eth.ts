import { generateAddress, parseAddress } from '@ckb-lumos/helpers';
import { BigNumber } from 'ethers';
import { LogDescription } from 'ethers/lib/utils';
import { TransferOutSwitch } from '../audit/switch';
import { ChainType, EthAsset } from '../ckb/model/asset';
import { forceBridgeRole } from '../config';
import { ForceBridgeCore } from '../core';
import { EthDb, KVDb, BridgeFeeDB } from '../db';
import { EthBurn } from '../db/entity/EthBurn';
import { CollectorEthMint } from '../db/entity/EthMint';
import { EthUnlockStatus } from '../db/entity/EthUnlock';
import { EthUnlock, ICkbUnlock, IEthUnlock } from '../db/model';
import { asserts, nonNullable } from '../errors';
import { BridgeMetricSingleton, txTokenInfo } from '../metric/bridge-metric';
import { asyncSleep, foreverPromise, fromHexString, retryPromise, uint8ArrayToString } from '../utils';
import { logger } from '../utils/logger';
import { EthChain, WithdrawBridgeFeeTopic, Log, ParsedLog } from '../xchain/eth';
import { checkLock } from '../xchain/eth/check';

const lastHandleEthBlockKey = 'lastHandleEthBlock';

export interface ParsedLockLog {
  txHash: string;
  sender: string;
  token: string;
  amount: string;
  recipient: string;
  sudtExtraData: string;
  blockNumber: number;
  blockHash: string;
  logIndex: number;
  asset: EthAsset;
}

export interface ParsedBurnLog {
  txHash: string;
  sender: string;
  token: string;
  amount: string;
  recipient: string;
  sudtExtraData: string;
  blockNumber: number;
  blockHash: string;
  logIndex: number;
  assetId: string;
}

export class EthHandler {
  private lastHandledBlockHeight: number;
  private lastHandledBlockHash: string;
  private startTipBlockHeight: number;

  constructor(
    private ethDb: EthDb,
    private feeDb: BridgeFeeDB,
    private kvDb: KVDb,
    private ethChain: EthChain,
    private role: forceBridgeRole,
  ) {}

  async setStartTipBlockHeight(): Promise<void> {
    this.startTipBlockHeight = (await this.getTipBlock()).height;
  }

  syncedToStartTipBlockHeight(): boolean {
    return (
      Boolean(this.lastHandledBlockHeight) &&
      Boolean(this.startTipBlockHeight) &&
      this.lastHandledBlockHeight > this.startTipBlockHeight
    );
  }

  async getLastHandledBlock(): Promise<{ blockNumber: number; blockHash: string }> {
    const lastHandledBlock = await this.kvDb.get(lastHandleEthBlockKey);
    if (!lastHandledBlock) {
      return { blockNumber: 0, blockHash: '' };
    }
    const block = lastHandledBlock.split(',');
    return { blockNumber: parseInt(block[0]), blockHash: block[1] };
  }

  async setLastHandledBlock(blockNumber: number, blockHash: string): Promise<void> {
    this.lastHandledBlockHeight = blockNumber;
    this.lastHandledBlockHash = blockHash;
    await this.kvDb.set(lastHandleEthBlockKey, `${blockNumber},${blockHash}`);
  }

  getHandledBlock(): { height: number; hash: string } {
    return { height: this.lastHandledBlockHeight, hash: this.lastHandledBlockHash };
  }

  async getTipBlock(): Promise<{ height: number; hash: string }> {
    const tipHeight = await this.ethChain.getCurrentBlockNumber();
    const tipBlock = await this.ethChain.getBlock(tipHeight);
    return { height: tipHeight, hash: tipBlock.hash };
  }

  async init(): Promise<void> {
    const currentBlockHeight = await this.ethChain.getCurrentBlockNumber();
    const lastHandledBlock = await this.getLastHandledBlock();
    if (lastHandledBlock.blockNumber === 0) {
      let lastHandledBlockHeight = currentBlockHeight;
      if (ForceBridgeCore.config.eth.startBlockHeight > 0) {
        lastHandledBlockHeight = ForceBridgeCore.config.eth.startBlockHeight;
      }
      const currentBlock = await this.ethChain.getBlock(lastHandledBlockHeight);
      this.lastHandledBlockHash = currentBlock.hash;
      this.lastHandledBlockHeight = currentBlock.number;
    } else {
      this.lastHandledBlockHash = lastHandledBlock.blockHash;
      this.lastHandledBlockHeight = lastHandledBlock.blockNumber;
    }

    logger.info(
      `EthHandler init lastHandledBlock:${this.lastHandledBlockHeight} currentBlockHeight: ${currentBlockHeight}`,
    );
  }

  async watchNewBlock(): Promise<void> {
    // set lastHandledBlock
    await this.init();
    await this.setStartTipBlockHeight();
    const maxBatchSize = 5000;
    let currentHeight: number | null = null;
    foreverPromise(
      async () => {
        let block = await this.ethChain.getBlock('latest');
        currentHeight = block.number;
        logger.info(`currentHeight: ${currentHeight}, lastHandledBlock: ${this.lastHandledBlockHeight}`);
        if (currentHeight - this.lastHandledBlockHeight < 1) {
          // already handled, wait for new block
          await asyncSleep(15000);
          return;
        }
        const confirmBlockNumber = this.lastHandledBlockHeight - ForceBridgeCore.config.eth.confirmNumber;
        const startBlockNumber = (confirmBlockNumber < 0 ? 0 : confirmBlockNumber) + 1;

        let endBlockNumber = currentHeight;
        if (currentHeight - this.lastHandledBlockHeight > maxBatchSize) {
          endBlockNumber = this.lastHandledBlockHeight + maxBatchSize;
          block = await this.ethChain.getBlock(endBlockNumber);
        }
        asserts(startBlockNumber <= endBlockNumber);
        const logs = await this.ethChain.getLogs(startBlockNumber, endBlockNumber);
        logger.info(
          `EthHandler onBlock handle logs from ${startBlockNumber} to ${endBlockNumber}, logs: ${JSON.stringify(logs)}`,
        );
        for (const log of logs) {
          await this.handleLog(log, currentHeight);
        }
        await this.setLastHandledBlock(block.number, block.hash);
        BridgeMetricSingleton.getInstance(this.role).setBlockHeightMetrics('eth', endBlockNumber, block.number);
        logger.info(`EthHandler onBlock blockHeight:${block.number} blockHash:${block.hash}`);
      },
      {
        onRejectedInterval: 15000,
        onResolvedInterval: 0,
        onRejected: (e: Error) => {
          logger.warn(`Eth watchNewBlock blockHeight:${currentHeight} error:${e.stack}`);
        },
      },
    );
  }

  async handleLog(log: Log, currentHeight: number): Promise<void> {
    const parsedLog = await this.ethChain.parseLog(log);
    if (!parsedLog) {
      return;
    }

    switch (parsedLog.name) {
      case 'Locked':
        await this.onLockLogs(log, parsedLog, currentHeight);
        break;
      case 'Unlocked':
        await this.onUnlockLogs(log, parsedLog);
        break;
      case 'Burn':
        await this.onBurnLogs(log, parsedLog, currentHeight);
        break;
      case 'Mint':
        await this.onMinted(log, parsedLog);
        break;
      default:
        logger.info(`not handled log type ${parsedLog.name}, log: ${JSON.stringify(log)}`);
    }
  }

  /**
   * For watcher and verifier, just save the record to mint table.
   * For collector, should update the record in collector mint table extra.
   * @param log
   * @param parsedLog
   * @returns
   */
  async onMinted(log: Log, parsedLog: ParsedLog): Promise<void> {
    logger.info(
      `EthHandler watchMintEvents receiveLog blockHeight:${log.blockNumber} blockHash:${log.blockHash} txHash:${log.transactionHash} amount:${parsedLog.args.amount} asset:${parsedLog.args.assetId} recipient:${parsedLog.args.to} ckbTxHash:${parsedLog.args.lockId}`,
    );

    logger.debug('EthHandler watchMintEvents eth unlockLog:', { log, parsedLog });

    const collectRecord = await this.ethDb.getCEthMintRecordByCkbTx(parsedLog.args.lockId);
    if (collectRecord == undefined) {
      logger.error(
        `EthHandler watchMintEvents no ckb tx mapped. ethTxHash:${log.transactionHash} ckbTxHash:${parsedLog.args.lockId}`,
      );

      return;
    }

    if (collectRecord.amount < parsedLog.args.amount) {
      logger.error(`EthHandler watchMintEvents amount is bigger than record. ethTxHash:${log.transactionHash}`);
      return;
    } else if (collectRecord.amount > parsedLog.args.amount) {
      logger.warn(`EthHandler watchMintEvents amount is smaller than record. ethTxHash:${log.transactionHash}`);
    }

    const block = await this.ethChain.getBlock(log.blockHash);

    collectRecord.ethTxHash = log.transactionHash;
    collectRecord.status = 'success';
    collectRecord.blockNumber = log.blockNumber;
    collectRecord.blockTimestamp = block.timestamp;

    if (this.role == 'collector') {
      await this.ethDb.saveCollectorEthMints([collectRecord]);
    }

    await this.updateMint(collectRecord, parsedLog);

    BridgeMetricSingleton.getInstance(this.role).addBridgeTokenMetrics('eth_mint', [
      {
        amount: Number(parsedLog.args.amount),
        token: parsedLog.args.assetId,
      },
    ]);
  }

  async updateMint(record: CollectorEthMint, parsedLog: LogDescription): Promise<void> {
    record.amount = parsedLog.args.amount;
    record.nervosAssetId = parsedLog.args.assetId;
    record.recipientAddress = parsedLog.args.to;
    record.erc20TokenAddress = parsedLog.args.token;

    await this.ethDb.saveEthMint(record);
  }

  async onBurnLogs(log: Log, parsedLog: ParsedLog, currentHeight: number): Promise<void> {
    const record = await this.ethDb.getBurnRecord(log.logIndex, log.transactionHash);
    const confirmedNumber = currentHeight - log.blockNumber;
    const confirmStatus = confirmedNumber >= ForceBridgeCore.config.eth.confirmNumber ? 'confirmed' : 'unconfirmed';
    const block = await this.ethChain.getBlock(log.blockHash);
    logger.info(
      `EthHandler watchBurnEvents receiveLog blockHeight:${log.blockNumber} blockHash:${log.blockHash} txHash:${
        log.transactionHash
      } amount:${parsedLog.args.amount.toString()} asset:${parsedLog.args.token} recipientLockscript:${
        parsedLog.args.recipient
      } sudtExtraData:${parsedLog.args.extraData} sender:${
        parsedLog.args.from
      }, confirmedNumber: ${confirmedNumber}, confirmStatus: ${confirmStatus}`,
    );
    if (record == undefined) {
      await this.ethDb.createEthBurn({
        burnTxHash: log.transactionHash,
        amount: parsedLog.args.amount,
        xchainTokenId: parsedLog.args.token,
        recipient: parsedLog.args.recipient,
        nervosAssetId: parsedLog.args.assetId,
        udtExtraData: parsedLog.args.extraData,
        blockNumber: log.blockNumber,
        blockHash: log.blockHash,
        sender: parsedLog.args.from,
        uniqueId: EthBurn.primaryKey(log.logIndex, log.transactionHash),
        bridgeFee: parsedLog.args.fee.toString(),
        confirmNumber: confirmedNumber,
        confirmStatus: confirmStatus,
        blockTimestamp: block.timestamp,
      });
      BridgeMetricSingleton.getInstance(this.role).addBridgeTxMetrics('eth_burn', 'success');
      BridgeMetricSingleton.getInstance(this.role).addBridgeTokenMetrics('eth_burn', [
        {
          amount: Number(parsedLog.args.amount),
          token: parsedLog.args.token,
        },
      ]);
    } else {
      record.amount = parsedLog.args.amount;
      record.recipient = parsedLog.args.recipient;
      record.udtExtraData = parsedLog.args.extraData;
      record.confirmStatus = confirmStatus;
      await this.ethDb.saveEthBurn(record);
      logger.info(
        `update burn record ${log.transactionHash} status, confirmed number: ${confirmedNumber} status ${confirmStatus}`,
      );
    }

    if (confirmStatus == 'confirmed' && this.role == 'collector') {
      const unlock: ICkbUnlock = {
        id: EthBurn.primaryKey(log.logIndex, log.transactionHash),
        burnTxHash: log.transactionHash,
        xchain: ChainType.ETH,
        udtExtraData: parsedLog.args.extraData,
        assetIdent: parsedLog.args.assetId,
        amount: parsedLog.args.amount,
        recipientAddress: parsedLog.args.recipient,
        blockTimestamp: block.timestamp,
        blockNumber: log.blockNumber,
        unlockTxHash: '',
        extraData: parsedLog.args.extraData,
      };
      await this.ethDb.createCollectorCkbUnlock([unlock]);
    }
  }

  async onLockLogs(log: Log, parsedLog: ParsedLog, currentHeight: number): Promise<void> {
    const parsedLockLog = parseLockLog(log, parsedLog);
    const { amount, asset, token, sudtExtraData, sender, txHash, recipient, blockNumber, blockHash, logIndex } =
      parsedLockLog;
    const uniqueId = `${txHash}-${logIndex}`;
    const records = await this.ethDb.getEthLocksByUniqueIds([uniqueId]);
    if (records.length > 1) {
      logger.error('unexpected db find error', records);
      throw new Error(`unexpected db find error, records.length = ${records.length}`);
    }
    const confirmedNumber = currentHeight - log.blockNumber;
    const confirmed = confirmedNumber >= ForceBridgeCore.config.eth.confirmNumber;
    const confirmStatus = confirmed ? 'confirmed' : 'unconfirmed';
    // create new EthLock record
    if (records.length === 0) {
      logger.info(
        `EthHandler watchLockEvents receiveLog blockHeight:${blockNumber} blockHash:${log.blockHash} txHash:${
          log.transactionHash
        } amount:${parsedLog.args.lockedAmount.toString()} asset:${parsedLog.args.token} recipientLockscript:${
          parsedLog.args.recipientLockscript
        } sudtExtraData:${parsedLog.args.sudtExtraData} sender:${
          parsedLog.args.sender
        }, confirmedNumber: ${confirmedNumber}, confirmed: ${confirmed}`,
      );
      logger.debug('EthHandler watchLockEvents eth lockEvtLog:', { log, parsedLog });
      if (sudtExtraData.length >= 10240 || recipient.length >= 10240) {
        logger.warn(
          `skip createEthLock for record ${JSON.stringify(
            parsedLog,
          )}, reason: recipient or sudtExtraData too long to fit in database`,
        );
        return;
      }
      await this.ethDb.createEthLock([
        {
          txHash,
          amount,
          token,
          recipient,
          sudtExtraData,
          blockNumber,
          blockHash,
          sender,
          uniqueId,
          bridgeFee: '0',
          confirmNumber: confirmedNumber,
          confirmStatus,
        },
      ]);
      BridgeMetricSingleton.getInstance(this.role).addBridgeTxMetrics('eth_lock', 'success');
      BridgeMetricSingleton.getInstance(this.role).addBridgeTokenMetrics('eth_lock', [
        {
          amount: Number(amount),
          token: token,
        },
      ]);
      await this.ethDb.updateBridgeInRecord(uniqueId, amount, token, recipient, sudtExtraData);
      logger.info(`EthHandler watchLockEvents save EthLock successful for eth tx ${log.transactionHash}.`);
    }
    if (records.length === 1) {
      await this.ethDb.updateLockConfirmNumber([{ uniqueId, confirmedNumber, confirmStatus }]);
      logger.info(`update lock record ${txHash} status, confirmed number: ${confirmedNumber}, status: ${confirmed}`);
    }
    if (confirmed && this.role === 'collector') {
      const filterReason = checkLock(
        parsedLockLog.amount,
        parsedLockLog.token,
        parsedLockLog.recipient,
        parsedLockLog.sudtExtraData,
      );
      if (filterReason !== '') {
        logger.warn(`skip createCkbMint for record ${JSON.stringify(parsedLog)}, reason: ${filterReason}`);
        return;
      }
      const bridgeFee = asset.getBridgeFee('in');
      const mintRecords = {
        id: uniqueId,
        lockBlockHeight: blockNumber,
        chain: ChainType.ETH,
        amount: (BigInt(amount) - BigInt(bridgeFee)).toString(),
        asset: token,
        recipientLockscript: recipient,
        sudtExtraData,
      };
      await this.ethDb.createCollectorCkbMint([mintRecords]);
      logger.info(`save CkbMint successful for eth tx ${txHash}`);
    }
  }

  async onUnlockLogs(log: Log, parsedLog: ParsedLog): Promise<void> {
    await retryPromise(
      async () => {
        const amount = parsedLog.args.receivedAmount.toString();
        const { ckbTxHash, recipient, token } = parsedLog.args;
        const unlockTxHash = log.transactionHash;
        logger.info(
          `EthHandler watchUnlockEvents receiveLog blockHeight:${log.blockNumber} blockHash:${log.blockHash} txHash:${unlockTxHash} amount:${amount} asset:${parsedLog.args.token} recipient:${parsedLog.args.recipient} ckbTxHash:${ckbTxHash} sender:${parsedLog.args.sender}`,
        );
        logger.debug('EthHandler watchUnlockEvents eth unlockLog:', { log, parsedLog });
        if (ckbTxHash === WithdrawBridgeFeeTopic) {
          await this.feeDb.createWithdrawedBridgeFee([
            {
              txHash: unlockTxHash,
              blockNumber: log.blockNumber,
              recipient: recipient,
              chain: ChainType.ETH,
              asset: token,
              amount: amount,
            },
          ]);
          return;
        }
        await this.ethDb.createEthUnlock([
          {
            ckbTxHash: ckbTxHash,
            amount: amount,
            asset: token,
            recipientAddress: recipient,
            blockNumber: log.blockNumber,
            ethTxHash: unlockTxHash,
          },
        ]);
        await this.ethDb.updateBurnBridgeFee(ckbTxHash, amount);
        if (this.role === 'collector') {
          await this.ethDb.updateCollectorUnlockStatus(ckbTxHash, log.blockNumber, 'success');
        }
        BridgeMetricSingleton.getInstance(this.role).addBridgeTokenMetrics('eth_unlock', [
          {
            amount: Number(amount),
            token: parsedLog.args.token,
          },
        ]);
      },
      {
        onRejected: (e: Error) => {
          logger.error(`EthHandler onUnlockLogs error:${e.stack}`);
        },
      },
    );
  }

  async getUnlockRecords(status: EthUnlockStatus): Promise<EthUnlock[]> {
    const toUnlockRecords = await this.ethDb.getEthUnlockRecordsToUnlock(status);
    const unlockedRecords = (await this.ethDb.getEthUnlockByCkbTxHashes(toUnlockRecords.map((r) => r.ckbTxHash))).map(
      (r) => r.ckbTxHash,
    );
    if (unlockedRecords.length > 0) {
      await this.ethDb.setCollectorEthUnlockToSuccess(unlockedRecords);
      return toUnlockRecords.filter((r) => unlockedRecords.indexOf(r.ckbTxHash) < 0);
    } else {
      return toUnlockRecords;
    }
  }

  handleMintRecords(): void {
    if (this.role !== 'collector') {
      return;
    }

    foreverPromise(
      async () => {
        const records = await this.ethDb.todoMintRecords();
        if (records.length <= 0) {
          logger.debug('wait for new mints');
          await asyncSleep(3000);
          return;
        }

        await this.mint(records);
      },
      {
        onRejectedInterval: 15000,
        onResolvedInterval: 15000,
        onRejected: (e: Error) => {
          logger.error(`ETH handleMintRecords error: ${e.stack}`);
        },
      },
    );
  }

  async mint(records: CollectorEthMint[]): Promise<void> {
    records = await this.ethDb.makeMintPending(records);
    const mintTxHashes = records.map((r) => r.ckbTxHash);

    if (records.length <= 0) {
      return;
    }

    try {
      const txRes = await this.ethChain.sendMintTxs(records);

      if (typeof txRes == 'boolean') {
        records.map((r) => {
          r.status = 'success';
        });

        await this.ethDb.saveCollectorEthMint(records);

        return;
      }

      if (txRes == undefined) {
        logger.warn(`ethHandler mint sendMintTxes response is undefined ckbHashes:${mintTxHashes}`);
        return;
      }

      await this.ethDb.saveCollectorEthMint(records);
      logger.debug('sendMintTx res', txRes);
      try {
        const receipt = await txRes.wait();
        logger.info(`EthHandler mint sendMintTxes receipt:${JSON.stringify(receipt.logs)}`);
        records.map((r) => {
          r.status = 'success';
          r.ethTxHash = txRes.hash;
        });

        const mintTokens = records.map((r) => {
          return {
            amount: Number(r.amount),
            token: r.erc20TokenAddress,
          };
        });

        BridgeMetricSingleton.getInstance(this.role).addBridgeTxMetrics('eth_mint', 'success');
        BridgeMetricSingleton.getInstance(this.role).addBridgeTokenMetrics('eth_mint', mintTokens);
      } catch (e) {
        records.map((r) => {
          r.status = 'error';
          r.message = e.message();
        });
        BridgeMetricSingleton.getInstance(this.role).addBridgeTxMetrics('eth_mint', 'failed');

        logger.error(`EthHandler mint ckbTxHashes:${mintTxHashes} mint execute failed:${e.stack}`);
      }
    } catch (e) {
      records.map((r) => {
        r.status = 'error';
        r.message = e.message;
      });
      BridgeMetricSingleton.getInstance(this.role).addBridgeTxMetrics('eth_mint', 'failed');

      logger.error(`EthHandler mint ckbTxHashes:${mintTxHashes} mint execute failed:${e.stack}`);
    }

    try {
      await this.ethDb.saveCollectorEthMints(records);
    } catch (e) {
      logger.error(`EthHandler mint db.saveEthMint ckbTxHashes:${mintTxHashes} error:${(e as Error).stack}`);
    }
  }

  // watch the eth_unlock table and handle the new unlock events
  // send tx according to the data
  handleUnlockRecords(): void {
    if (this.role !== 'collector') {
      return;
    }
    this.handleTodoUnlockRecords();
  }

  handleTodoUnlockRecords(): void {
    foreverPromise(
      async () => {
        if (!TransferOutSwitch.getInstance().getStatus()) {
          logger.info('TransferOutSwitch is off, skip handleTodoUnlockRecords');
          return;
        }
        if (!this.syncedToStartTipBlockHeight()) {
          logger.info(
            `wait until syncing to startBlockHeight, lastHandledBlockHeight: ${this.lastHandledBlockHeight}, startTipBlockHeight: ${this.startTipBlockHeight}`,
          );
          return;
        }
        logger.debug('EthHandler watchUnlockEvents get new unlock events and send tx');
        const records = await this.getUnlockRecords('todo');
        if (records.length === 0) {
          logger.info('wait for todo unlock records');
          return;
        }
        logger.info(`EthHandler watchUnlockEvents unlock records: ${JSON.stringify(records)}`);
        await this.doHandleUnlockRecords(records);
      },
      {
        onRejectedInterval: 15000,
        onResolvedInterval: 15000,
        onRejected: (e: Error) => {
          logger.error(`ETH handleTodoUnlockRecords error:${e.stack}`);
        },
      },
    );
  }

  async doHandleUnlockRecords(records: IEthUnlock[]): Promise<void> {
    if (records.length === 0) {
      return;
    }

    const unlockTxHashes = records
      .map((unlockRecord) => {
        return unlockRecord.ckbTxHash;
      })
      .join(', ');
    logger.info(
      `EthHandler doHandleUnlockRecords start process unlock Record, ckbTxHashes:${unlockTxHashes} num:${records.length}`,
    );

    for (;;) {
      try {
        // check gas price
        const gasPrice = await this.ethChain.getGasPrice();
        const gasPriceLimit = BigNumber.from(nonNullable(ForceBridgeCore.config.collector).gasPriceGweiLimit * 10 ** 9);
        logger.debug(`gasPrice ${gasPrice}, gasPriceLimit ${gasPriceLimit}`);
        if (gasPrice.gt(gasPriceLimit)) {
          const waitSeconds = 30;
          logger.warn(`gasPrice ${gasPrice} exceeds limit ${gasPriceLimit}, waiting for ${waitSeconds}s`);
          await asyncSleep(waitSeconds * 1000);
          continue;
        }
        // write db first, avoid send tx success and fail to write db
        records.map((r) => {
          r.status = 'pending';
        });
        await this.ethDb.saveCollectorEthUnlock(records);
        const txRes = await this.ethChain.sendUnlockTxs(records);
        if (typeof txRes === 'boolean') {
          records.map((r) => {
            r.status = 'success';
          });
          break;
        }
        if (txRes instanceof Error) {
          if (records.length > 1) {
            logger.warn(`split batch unlock into separate ones for records: ${JSON.stringify(records)}`);
            for (const r of records) {
              await this.doHandleUnlockRecords([r]);
            }
            return;
          }
          records.map((r) => {
            r.status = 'error';
            r.message = (txRes as Error).message;
          });
          BridgeMetricSingleton.getInstance(this.role).addBridgeTxMetrics('eth_unlock', 'failed');
          logger.error(
            `EthHandler doHandleUnlockRecords ckbTxHashes:${unlockTxHashes}  sendUnlockTxs error:${txRes as Error}`,
          );
          break;
        }

        records.map((r) => {
          r.status = 'pending';
          r.ethTxHash = txRes.hash;
        });
        await this.ethDb.saveCollectorEthUnlock(records);
        logger.debug('sendUnlockTxs res', txRes);
        try {
          // wait() will reject if the tx fails
          // https://docs.ethers.io/v5/api/providers/types/#providers-TransactionResponse
          const receipt = await txRes.wait();
          logger.info(`EthHandler doHandleUnlockRecords sendUnlockTxs receipt:${JSON.stringify(receipt.logs)}`);
          records.map((r) => {
            r.status = 'success';
          });
          const unlockTokens = records.map((r) => {
            const tokenInfo: txTokenInfo = {
              amount: Number(r.amount),
              token: r.asset,
            };
            return tokenInfo;
          });
          BridgeMetricSingleton.getInstance(this.role).addBridgeTokenMetrics('eth_unlock', unlockTokens);
          BridgeMetricSingleton.getInstance(this.role).addBridgeTxMetrics('eth_unlock', 'success');
        } catch (error) {
          records.map((r) => {
            r.status = 'error';
            r.message = error.toString();
          });
          BridgeMetricSingleton.getInstance(this.role).addBridgeTxMetrics('eth_unlock', 'failed');
          logger.error(
            `EthHandler doHandleUnlockRecords ckbTxHashes:${unlockTxHashes} unlock execute failed:${error.stack}`,
          );
        }
        break;
      } catch (e) {
        logger.error(`EthHandler doHandleUnlockRecords ckbTxHashes:${unlockTxHashes} error:${e.stack}`);
        await asyncSleep(5000);
      }
    }
    for (;;) {
      try {
        await this.ethDb.saveCollectorEthUnlock(records);
        logger.info(`EthHandler doHandleUnlockRecords process unlock Record completed ckbTxHashes:${unlockTxHashes}`);
        break;
      } catch (e) {
        logger.error(
          `EthHandler doHandleUnlockRecords db.saveEthUnlock ckbTxHashes:${unlockTxHashes} error:${e.stack}`,
        );
        await asyncSleep(3000);
      }
    }
  }

  start(): void {
    void this.watchNewBlock();

    Promise.all([this.handleUnlockRecords, this.handleMintRecords]).catch((e) => logger.error(e));
    logger.info('eth handler started  🚀');
  }
}

export function parseLockLog(log: Log, parsedLog: ParsedLog): ParsedLockLog {
  const txHash = log.transactionHash;
  const { token, sudtExtraData, sender } = parsedLog.args;
  const amount = parsedLog.args.lockedAmount.toString();
  const asset = new EthAsset(parsedLog.args.token);
  const recipient = uint8ArrayToString(fromHexString(parsedLog.args.recipientLockscript));
  return {
    txHash: txHash,
    amount: amount,
    token: token,
    recipient: toCKBAddress2021(recipient),
    sudtExtraData: sudtExtraData,
    blockNumber: log.blockNumber,
    blockHash: log.blockHash,
    logIndex: log.logIndex,
    sender: sender,
    asset,
  };
}

function toCKBAddress2021(address: string): string {
  try {
    const newAddress = generateAddress(parseAddress(address));
    return newAddress;
  } catch (e) {
    logger.warn(`parse recipient address from ethereum log failed, recipient address ${address}, error ${e}`);
    return address;
  }
}
