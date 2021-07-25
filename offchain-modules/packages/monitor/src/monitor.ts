import { CkbBurnRecord, CkbMintRecord, EthLockRecord, EthUnlockRecord } from '@force-bridge/reconc/dist';
import { EthAsset } from '@force-bridge/x/dist/ckb/model/asset';
import { getOwnerTypeHash } from '@force-bridge/x/dist/ckb/tx-helper/multisig/multisig_helper';
import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { CKBRecordObservable } from '@force-bridge/x/dist/reconc';
import { asyncSleep, foreverPromise } from '@force-bridge/x/dist/utils';
import { logger } from '@force-bridge/x/dist/utils/logger';
import { EthRecordObservable } from '@force-bridge/xchain-eth/dist/reconc';
import { ethers } from 'ethers';
import { Config, readMonitorConfig, writeMonitorConfig } from './config';
import { sendDiscordMessage } from './utils';

const defStep = 100;
let expiredTime = 60 * 1000;

export type ckbMonitorEvent = CkbMintRecord | CkbBurnRecord;
export type ethMonitorEvent = EthLockRecord | EthUnlockRecord;
export type monitorEvent = ckbMonitorEvent | ethMonitorEvent;

class eventItem {
  addTime: number;
  id: string;
  event: monitorEvent;
  isExpired: boolean;

  constructor(id: string, event: monitorEvent, expired = false) {
    this.addTime = new Date().getTime();
    this.id = id;
    this.event = event;
    this.isExpired = expired;
  }

  expired(): boolean {
    return new Date().getTime() - this.addTime >= expiredTime;
  }

  resetAddTime(): void {
    this.addTime = new Date().getTime();
    if (!this.isExpired) {
      this.isExpired = true;
    }
  }
}

class eventCache {
  private cache: Map<string, eventItem>;
  constructor() {
    this.cache = new Map<string, eventItem>();
  }

  addEvent(id: string, event: monitorEvent, expired = false): void {
    this.cache.set(id, new eventItem(id, event, expired));
  }

  getEvent(id: string): monitorEvent | undefined {
    const item = this.cache.get(id);
    if (!item) {
      return undefined;
    }
    return item.event;
  }

  delEvent(id: string): void {
    this.cache.delete(id);
  }

  forEach(fn: (value: eventItem, key: string, map: Map<string, eventItem>) => void): void {
    return this.cache.forEach(fn);
  }

  length(): number {
    return this.cache.size;
  }
}

export class Monitor {
  private ethProvider: ethers.providers.JsonRpcProvider;
  private ethLockCache: eventCache;
  private ethUnlockCache: eventCache;
  private ckbBurnCache: eventCache;
  private ckbMintCache: eventCache;
  private ownerTypeHash: string;
  private ethLastScannedBlock: number;
  private ckbLastScannedBlock: number;
  private config: Config;

  constructor(private ethRecordObservable: EthRecordObservable, private ckbRecordObservable: CKBRecordObservable) {
    this.ethProvider = new ethers.providers.JsonRpcProvider(ForceBridgeCore.config.eth.rpcUrl);
    this.ethLockCache = new eventCache();
    this.ethUnlockCache = new eventCache();
    this.ckbBurnCache = new eventCache();
    this.ckbMintCache = new eventCache();
    this.ownerTypeHash = getOwnerTypeHash();
  }

  onEthLockRecord(lock: EthLockRecord, expired = false): void {
    logger.info(`Receive ethLock:${JSON.stringify(lock)}`);

    const id = lock.txId;
    const event = this.ckbMintCache.getEvent(id);
    if (!event) {
      this.ethLockCache.addEvent(id, lock, expired);
      return;
    }
    const mint = event as CkbMintRecord;
    const compared = this.compareEthLockAndMint(lock, mint);
    if (compared !== '') {
      throw new Error(compared);
    }
    this.ethLockCache.delEvent(id);
    this.ckbMintCache.delEvent(id);
  }

  onEthUnlockRecord(unlock: EthUnlockRecord, expired = false): void {
    logger.info(`Receive ethUnlock:${JSON.stringify(unlock)}`);

    const id = unlock.fromTxId!;
    const event = this.ckbBurnCache.getEvent(id);
    if (!event) {
      this.ethUnlockCache.addEvent(id, unlock, expired);
      return;
    }

    const burn = event as CkbBurnRecord;
    const compared = this.compareCkbBurnAndUnlock(burn, unlock);
    if (compared !== '') {
      throw new Error(compared);
    }
    this.ckbBurnCache.delEvent(id);
    this.ethUnlockCache.delEvent(id);
  }

  onCkbMintRecord(mint: CkbMintRecord, expired = false): void {
    logger.info(`Receive ckbMint:${JSON.stringify(mint)}`);

    const id = mint.fromTxId!;
    const event = this.ethLockCache.getEvent(id);
    if (!event) {
      this.ckbMintCache.addEvent(id, mint, expired);
      return;
    }
    const lock = event as EthLockRecord;
    const compared = this.compareEthLockAndMint(lock, mint);
    if (compared !== '') {
      throw new Error(compared);
    }
    this.ethLockCache.delEvent(id);
    this.ckbMintCache.delEvent(id);
  }

  onCkbBurnRecord(burn: CkbBurnRecord, expired = false): void {
    logger.info(`Receive ckbBurn:${JSON.stringify(burn)}`);

    const id = burn.txId;
    const event = this.ethUnlockCache.getEvent(id);
    if (!event) {
      this.ckbBurnCache.addEvent(id, burn, expired);
      return;
    }
    const unlock = event as EthUnlockRecord;
    const compared = this.compareCkbBurnAndUnlock(burn, unlock);
    if (compared !== '') {
      throw new Error(compared);
    }
    this.ckbBurnCache.delEvent(id);
    this.ethUnlockCache.delEvent(id);
  }

  compareEthLockAndMint(lock: EthLockRecord, mint: CkbMintRecord): string {
    if (lock.recipient != mint.recipient) {
      return `lock.recipient:${lock.recipient} != mint.recipient:${mint.recipient}`;
    }
    const fee = new EthAsset(lock.token, this.ownerTypeHash).getBridgeFee('in');
    if (BigInt(lock.amount) !== BigInt(fee) + BigInt(mint.amount)) {
      return `mint.amount:${mint.amount} + fee:${fee} != lock.amount:${lock.amount}`;
    }
    return '';
  }

  compareCkbBurnAndUnlock(burn: CkbBurnRecord, unlock: EthUnlockRecord): string {
    if (burn.recipient !== unlock.recipient) {
      return `burn.recipient:${burn.recipient} !== unlock.recipient:${unlock.recipient}`;
    }
    if (BigInt(burn.amount) !== BigInt(unlock.amount) + BigInt(unlock.fee!)) {
      return `burn.amount:${burn.amount} != unlock.amount:${unlock.amount} + fee:${unlock.fee}`;
    }
    return '';
  }

  async start(): Promise<void> {
    this.init();
    this.observeEthEvent().catch((err) => {
      logger.error(`Monitor observeEthEvent error:${err.stack}`);
    });
    this.observeCkbEvent().catch((err) => {
      logger.error(`Monitor observeCkbEvent error:${err.stack}`);
    });
    setTimeout(() => {
      this.checkExpiredEvent();
    }, 1000);
  }

  init(): void {
    this.config = readMonitorConfig();
    if (this.config.common.expiredTime && this.config.common.expiredTime > 0) {
      expiredTime = this.config.common.expiredTime;
    }
    if (!this.config.eth.scanStep || this.config.eth.scanStep <= 0) {
      this.config.eth.scanStep = defStep;
    }
    if (!this.config.ckb.scanStep || this.config.ckb.scanStep <= 0) {
      this.config.ckb.scanStep = defStep;
    }

    this.config.ckb.expiredEvents.forEach((record) => {
      if ((record as CkbMintRecord).fromTxId) {
        this.onCkbMintRecord(record, true);
      } else {
        this.onCkbBurnRecord(record as unknown as CkbBurnRecord, true);
      }
    });
    this.config.ckb.pendingEvents.forEach((record) => {
      if ((record as CkbMintRecord).fromTxId) {
        this.onCkbMintRecord(record);
      } else {
        this.onCkbBurnRecord(record as unknown as CkbBurnRecord);
      }
    });
    this.config.eth.expiredEvents.forEach((record) => {
      if ((record as EthUnlockRecord).fromTxId) {
        this.onEthUnlockRecord(record, true);
      } else {
        this.onEthLockRecord(record as unknown as EthLockRecord, true);
      }
    });
    this.config.eth.pendingEvents.forEach((record) => {
      if ((record as EthUnlockRecord).fromTxId) {
        this.onEthUnlockRecord(record);
      } else {
        this.onEthLockRecord(record as unknown as EthLockRecord);
      }
    });
    this.ckbLastScannedBlock = this.config.ckb.lastHandledBlock;
    this.ethLastScannedBlock = this.config.eth.lastHandledBlock;
  }

  checkExpiredEvent(): void {
    foreverPromise(
      async () => {
        const ckbPendingEvents: ckbMonitorEvent[] = [];
        const ethPendingEvents: ethMonitorEvent[] = [];
        const ckbExpiredEvents: eventItem[] = [];
        const ethExpiredEvents: eventItem[] = [];

        const ckbChecker = (value: eventItem): void => {
          if (value.expired()) {
            ckbExpiredEvents.push(value);
            return;
          }
          if (!value.isExpired) {
            ckbPendingEvents.push(value.event as ckbMonitorEvent);
          }
        };
        const ethChecker = (value: eventItem): void => {
          if (value.expired()) {
            ethExpiredEvents.push(value);
            return;
          }
          if (!value.isExpired) {
            ethPendingEvents.push(value.event as ethMonitorEvent);
          }
        };
        this.ckbBurnCache.forEach(ckbChecker);
        this.ckbMintCache.forEach(ckbChecker);
        this.ethLockCache.forEach(ethChecker);
        this.ethUnlockCache.forEach(ethChecker);

        let isSend = false;
        if (ethExpiredEvents.length > 0) {
          logger.info(`Eth expired events ${JSON.stringify(ethExpiredEvents)}`);
          sendDiscordMessage(`Eth expired events:${JSON.stringify(ethExpiredEvents, undefined, 2)}`, '', '');
          isSend = true;
          ethExpiredEvents.forEach((value) => {
            value.resetAddTime();
          });
        }
        if (ckbExpiredEvents.length > 0) {
          logger.info(`CKB expired events ${JSON.stringify(ckbExpiredEvents)}`);
          sendDiscordMessage(`CKB expired events:${JSON.stringify(ckbExpiredEvents, undefined, 2)}`, '', '');
          isSend = true;
          ckbExpiredEvents.forEach((value) => {
            value.resetAddTime();
          });
        }

        if (ckbPendingEvents.length === 0) {
          this.config.ckb.lastHandledBlock = this.ckbLastScannedBlock;
        }
        if (ethPendingEvents.length === 0) {
          this.config.eth.lastHandledBlock = this.ethLastScannedBlock;
        }

        this.config.eth.pendingEvents = ethPendingEvents;
        this.config.eth.expiredEvents = ethExpiredEvents.map((item) => item.event as ethMonitorEvent);
        this.config.ckb.pendingEvents = ckbPendingEvents;
        this.config.ckb.expiredEvents = ckbExpiredEvents.map((item) => item.event as ckbMonitorEvent);

        writeMonitorConfig(this.config);

        const recordsNum = {
          ethLockNum: this.ethLockCache.length(),
          ethUnlockNum: this.ethUnlockCache.length(),
          ckbMintNum: this.ckbMintCache.length(),
          ckbBurnNum: this.ckbBurnCache.length(),
        };
        logger.info(`Monitor records number in cache:${JSON.stringify(recordsNum)}`);
        if (!isSend) {
          sendDiscordMessage(`${JSON.stringify(recordsNum, undefined, 2)}`, '', '');
        }
      },
      {
        onRejectedInterval: 5000,
        onResolvedInterval: 10000,
        onRejected: (e: Error) => {
          logger.error(`Monitor observeEthLock error:${e.stack}`);
        },
      },
    );
  }

  async observeCkbEvent(): Promise<void> {
    let fromBlock = this.ckbLastScannedBlock;
    let blockNumber =
      Number(await ForceBridgeCore.ckb.rpc.getTipBlockNumber()) - ForceBridgeCore.config.ckb.confirmNumber;
    const step = this.config.ckb.scanStep;
    let toBlock = fromBlock + step > blockNumber ? blockNumber : fromBlock + step;

    foreverPromise(
      async () => {
        logger.info(`Monitor observeCkbEvent fromBlock:${fromBlock} toBlock:${toBlock}`);

        const blockNumMap: Map<string, number> = new Map();
        const ckbEventRecords: ckbMonitorEvent[] = [];

        const fillBlockNumbers = async (records: ckbMonitorEvent[]) => {
          for (const record of records) {
            const blockHash = (await ForceBridgeCore.ckb.rpc.getTransactionProof([record.txId])).blockHash;
            let blockHeight = blockNumMap.get(blockHash);
            if (!blockHeight) {
              blockHeight = Number((await ForceBridgeCore.ckb.rpc.getHeader(blockHash)).number);
              blockNumMap.set(blockHash, blockHeight);
            }
            record.blockHash = blockHash;
            record.blockNumber = blockHeight;
          }
          records.sort((a, b) => {
            return a.blockNumber! - b.blockNumber!;
          });
        };

        await this.ckbRecordObservable
          .observeMintRecord({ fromBlock: '0x' + fromBlock.toString(16), toBlock: '0x' + toBlock.toString(16) })
          .forEach((record) => {
            ckbEventRecords.push(record);
          });

        await this.ckbRecordObservable
          .observeBurnRecord({
            fromBlock: '0x' + fromBlock.toString(16),
            toBlock: '0x' + toBlock.toString(16),
            filterRecipientData: (data) => {
              const recipientOwnerCellTypeHash = '0x' + Buffer.from(data.getOwnerCellTypeHash().raw()).toString('hex');
              return recipientOwnerCellTypeHash === getOwnerTypeHash();
            },
          })
          .forEach((record) => {
            ckbEventRecords.push(record);
          });

        await fillBlockNumbers(ckbEventRecords);
        ckbEventRecords.forEach((record) => {
          if ((record as CkbMintRecord).fromTxId) {
            this.onCkbMintRecord(record);
          } else {
            this.onCkbBurnRecord(record as unknown as CkbBurnRecord);
          }
          this.config.ckb.lastHandledBlock = record.blockNumber!;
        });

        this.ckbLastScannedBlock = toBlock;

        for (;;) {
          blockNumber =
            Number(await ForceBridgeCore.ckb.rpc.getTipBlockNumber()) - ForceBridgeCore.config.ckb.confirmNumber;
          if (toBlock >= blockNumber) {
            await asyncSleep(10000);
            continue;
          }
          fromBlock = toBlock + 1;
          toBlock = fromBlock + step > blockNumber ? blockNumber : fromBlock + step;
          break;
        }
      },
      {
        onRejectedInterval: 10000,
        onResolvedInterval: 0,
        onRejected: (e: Error) => {
          logger.error(`Monitor observeEthLock error:${e.stack}`);
        },
      },
    );
  }

  async observeEthEvent(): Promise<void> {
    let fromBlock = this.ethLastScannedBlock;
    let blockNumber = (await this.ethProvider.getBlockNumber()) - ForceBridgeCore.config.eth.confirmNumber;
    const step = this.config.ckb.scanStep;
    let toBlock = fromBlock + step > blockNumber ? blockNumber : fromBlock + step;

    foreverPromise(
      async () => {
        logger.info(`Monitor observeEthEvent fromBlock:${fromBlock} toBlock:${toBlock}`);

        const ethMonitorRecords: ethMonitorEvent[] = [];

        await this.ethRecordObservable
          .observeLockRecord({}, { fromBlock: fromBlock, toBlock: toBlock })
          .forEach((record) => {
            ethMonitorRecords.push(record);
          });

        await this.ethRecordObservable
          .observeUnlockRecord({}, { fromBlock: fromBlock, toBlock: toBlock })
          .forEach((record) => {
            ethMonitorRecords.push(record);
          });

        ethMonitorRecords.sort((a, b) => {
          return a.blockNumber - b.blockNumber;
        });
        ethMonitorRecords.forEach((record) => {
          if ((record as EthUnlockRecord).fromTxId) {
            this.onEthUnlockRecord(record);
          } else {
            this.onEthLockRecord(record as EthLockRecord);
          }
          this.config.eth.lastHandledBlock = record.blockNumber;
        });

        this.ethLastScannedBlock = toBlock;

        for (;;) {
          blockNumber = (await this.ethProvider.getBlockNumber()) - ForceBridgeCore.config.eth.confirmNumber;
          if (toBlock >= blockNumber) {
            await asyncSleep(10000);
            continue;
          }
          fromBlock = toBlock + 1;
          toBlock = fromBlock + step > blockNumber ? blockNumber : fromBlock + step;
          break;
        }
      },
      {
        onRejectedInterval: 10000,
        onResolvedInterval: 0,
        onRejected: (e: Error) => {
          logger.error(`Monitor observeEthLock error:${e.stack}`);
        },
      },
    );
  }
}
