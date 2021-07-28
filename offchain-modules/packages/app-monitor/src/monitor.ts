import { CkbBurnRecord, CkbMintRecord, EthLockRecord, EthUnlockRecord } from '@force-bridge/reconc/dist';
import { EthAsset } from '@force-bridge/x/dist/ckb/model/asset';
import { getOwnerTypeHash } from '@force-bridge/x/dist/ckb/tx-helper/multisig/multisig_helper';
import { bootstrap, ForceBridgeCore } from '@force-bridge/x/dist/core';
import { CKBRecordObservable } from '@force-bridge/x/dist/reconc';
import { asyncSleep, foreverPromise } from '@force-bridge/x/dist/utils';
import { logger } from '@force-bridge/x/dist/utils/logger';
import {
  createCKBRecordObservable,
  createETHRecordObservable,
  EthRecordObservable,
} from '@force-bridge/xchain-eth/dist/reconc';
import { BigNumber } from 'bignumber.js';
import { ethers } from 'ethers';
import { WebHook } from './discord';
import { Duration, NewDurationCfg, readMonitorConfig, writeMonitorConfig } from './duration';

let step = 100;
let expiredTime = 1200 * 1000;
let expiredCheckInterval = 10 * 1000;

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
  private readonly ethLockCache: eventCache;
  private readonly ethUnlockCache: eventCache;
  private readonly ckbBurnCache: eventCache;
  private readonly ckbMintCache: eventCache;
  private ownerTypeHash: string;
  private ethLastScannedBlock: number;
  private ckbLastScannedBlock: number;
  private durationConfig: Duration;

  constructor(private ethRecordObservable: EthRecordObservable, private ckbRecordObservable: CKBRecordObservable) {
    this.ethProvider = new ethers.providers.JsonRpcProvider(ForceBridgeCore.config.eth.rpcUrl);
    this.ethLockCache = new eventCache();
    this.ethUnlockCache = new eventCache();
    this.ckbBurnCache = new eventCache();
    this.ckbMintCache = new eventCache();
    this.ownerTypeHash = getOwnerTypeHash();
  }

  async onEthLockRecord(lock: EthLockRecord, expired = false): Promise<void> {
    logger.info(`Receive ethLock:${JSON.stringify(lock)}`);

    const id = lock.txId;
    const event = this.ckbMintCache.getEvent(id);
    if (!event) {
      this.ethLockCache.addEvent(id, lock, expired);
      return;
    }
    const mint = event as CkbMintRecord;
    const compared = await this.compareEthLockAndCkbMint(lock, mint);
    if (compared) {
      this.ethLockCache.delEvent(id);
      this.ckbMintCache.delEvent(id);
    }
  }

  async onEthUnlockRecord(unlock: EthUnlockRecord, expired = false): Promise<void> {
    logger.info(`Receive ethUnlock:${JSON.stringify(unlock)}`);

    const id = unlock.fromTxId!;
    const event = this.ckbBurnCache.getEvent(id);
    if (!event) {
      this.ethUnlockCache.addEvent(id, unlock, expired);
      return;
    }

    const burn = event as CkbBurnRecord;
    const compared = await this.compareCkbBurnAndEthUnlock(burn, unlock);
    if (compared) {
      this.ckbBurnCache.delEvent(id);
      this.ethUnlockCache.delEvent(id);
    }
  }

  async onCkbMintRecord(mint: CkbMintRecord, expired = false): Promise<void> {
    logger.info(`Receive ckbMint:${JSON.stringify(mint)}`);

    const id = mint.fromTxId!;
    const event = this.ethLockCache.getEvent(id);
    if (!event) {
      this.ckbMintCache.addEvent(id, mint, expired);
      return;
    }
    const lock = event as EthLockRecord;
    const compared = await this.compareEthLockAndCkbMint(lock, mint);
    if (compared) {
      this.ethLockCache.delEvent(id);
      this.ckbMintCache.delEvent(id);
    }
  }

  async onCkbBurnRecord(burn: CkbBurnRecord, expired = false): Promise<void> {
    logger.info(`Receive ckbBurn:${JSON.stringify(burn)}`);

    const id = burn.txId;
    const event = this.ethUnlockCache.getEvent(id);
    if (!event) {
      this.ckbBurnCache.addEvent(id, burn, expired);
      return;
    }
    const unlock = event as EthUnlockRecord;
    const compared = await this.compareCkbBurnAndEthUnlock(burn, unlock);
    if (compared) {
      this.ckbBurnCache.delEvent(id);
      this.ethUnlockCache.delEvent(id);
    }
  }

  async compareEthLockAndCkbMint(lock: EthLockRecord, mint: CkbMintRecord): Promise<boolean> {
    const checker = (lock: EthLockRecord, mint: CkbMintRecord): string => {
      if (lock.recipient.toLowerCase() != mint.recipient.toLowerCase()) {
        return `lock.recipient:${lock.recipient} != mint.recipient:${mint.recipient}`;
      }
      const fee = new EthAsset(lock.token, this.ownerTypeHash).getBridgeFee('in');
      if (!new BigNumber(lock.amount).eq(new BigNumber(fee).plus(new BigNumber(mint.amount)))) {
        return `mint.amount:${mint.amount} + fee:${fee} != lock.amount:${lock.amount}`;
      }
      return '';
    };

    const res = checker(lock, mint);
    if (res === '') {
      return true;
    }
    await new WebHook()
      .setTitle('compareEthLockAndCkbMint error' + ` - ${ForceBridgeCore.config.monitor!.env}`)
      .setDescription(res)
      .addTimeStamp()
      .error()
      .send();
    logger.error(`lock:${JSON.stringify(lock)} mint:${JSON.stringify(mint)} error:${res}`);
    return false;
  }

  async compareCkbBurnAndEthUnlock(burn: CkbBurnRecord, unlock: EthUnlockRecord): Promise<boolean> {
    const checker = (burn: CkbBurnRecord, unlock: EthUnlockRecord): string => {
      if (burn.recipient.toLowerCase() !== unlock.recipient.toLowerCase()) {
        return `burn.recipient:${burn.recipient} !== unlock.recipient:${unlock.recipient}`;
      }
      if (!new BigNumber(burn.amount).eq(new BigNumber(unlock.fee!).plus(new BigNumber(unlock.amount)))) {
        return `burn.amount:${burn.amount} != unlock.amount:${unlock.amount} + fee:${unlock.fee}`;
      }
      return '';
    };
    const res = checker(burn, unlock);
    if (res === '') {
      return true;
    }
    await new WebHook()
      .setTitle('compareCkbBurnAndEthUnlock error' + ` - ${ForceBridgeCore.config.monitor!.env}`)
      .setDescription(res)
      .addTimeStamp()
      .error()
      .send();
    logger.error(`burn:${JSON.stringify(burn)} unlock:${JSON.stringify(unlock)} error:${res}`);
    return false;
  }

  async start(): Promise<void> {
    await this.init();
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

  async init(): Promise<void> {
    let durationConfig = readMonitorConfig();
    if (!durationConfig) {
      durationConfig = NewDurationCfg();
    }
    this.durationConfig = durationConfig;
    if (ForceBridgeCore.config.monitor!.expiredTime > 0) {
      expiredTime = ForceBridgeCore.config.monitor!.expiredTime;
    }
    if (ForceBridgeCore.config.monitor!.scanStep > 0) {
      step = ForceBridgeCore.config.monitor!.scanStep;
    }
    if (ForceBridgeCore.config.monitor!.expiredCheckInterval > 0) {
      expiredCheckInterval = ForceBridgeCore.config.monitor!.expiredCheckInterval;
    }

    for (const record of this.durationConfig.ckb.expired.mints) {
      await this.onCkbMintRecord(record, true);
    }
    for (const record of this.durationConfig.ckb.expired.burns) {
      await this.onCkbBurnRecord(record, true);
    }
    for (const record of this.durationConfig.ckb.pending.mints) {
      await this.onCkbMintRecord(record);
    }
    for (const record of this.durationConfig.ckb.pending.burns) {
      await this.onCkbBurnRecord(record);
    }
    for (const record of this.durationConfig.eth.expired.locks) {
      await this.onEthLockRecord(record, true);
    }
    for (const record of this.durationConfig.eth.expired.unlocks) {
      await this.onEthUnlockRecord(record, true);
    }
    for (const record of this.durationConfig.eth.pending.locks) {
      await this.onEthLockRecord(record);
    }
    for (const record of this.durationConfig.eth.pending.unlocks) {
      await this.onEthUnlockRecord(record);
    }

    this.ckbLastScannedBlock = this.durationConfig.ckb.lastHandledBlock;
    this.ethLastScannedBlock = this.durationConfig.eth.lastHandledBlock;
  }

  checkExpiredEvent(): void {
    foreverPromise(
      async () => {
        const ckbBurnPendingEvents: CkbBurnRecord[] = [];
        const ckbBurnExpiredEvents: eventItem[] = [];
        const ckbMintPendingEvents: CkbMintRecord[] = [];
        const ckbMintExpiredEvents: eventItem[] = [];
        const ethLockPendingEvents: EthLockRecord[] = [];
        const ethLockExpiredEvents: eventItem[] = [];
        const ethUnlockPendingEvents: EthUnlockRecord[] = [];
        const ethUnlockExpiredEvents: eventItem[] = [];

        let isExpiredEventSend = false;
        const expiredCheck = async (
          cache: eventCache,
          expiredItems: eventItem[],
          pendingEvents: monitorEvent[],
          msg: string,
        ): Promise<void> => {
          const curExpired: monitorEvent[] = [];
          cache.forEach((item) => {
            if (item.expired()) {
              curExpired.push(item.event);
              item.resetAddTime();
            }
            if (item.isExpired) {
              expiredItems.push(item);
            } else {
              pendingEvents.push(item.event);
            }
          });
          for (const expiredEvent of curExpired) {
            const detail = JSON.stringify(expiredEvent);
            logger.error(msg, detail);
            await new WebHook()
              .setTitle(msg + ` - ${ForceBridgeCore.config.monitor!.env}`)
              .setDescription(detail)
              .addTimeStamp()
              .error()
              .send();
            isExpiredEventSend = true;
          }
        };

        await expiredCheck(this.ethLockCache, ethLockExpiredEvents, ethLockPendingEvents, 'ETH lock timeout');
        await expiredCheck(this.ethUnlockCache, ethUnlockExpiredEvents, ethUnlockPendingEvents, 'ETH unlock timeout');
        await expiredCheck(this.ckbBurnCache, ckbBurnExpiredEvents, ckbBurnPendingEvents, 'CKB Burn timeout');
        await expiredCheck(this.ckbMintCache, ckbMintExpiredEvents, ckbMintPendingEvents, 'CKB Mint timeout');

        const filterPendingEvents = (pendingEvents: monitorEvent[], lastHandledBlock: number): monitorEvent[] => {
          return pendingEvents.filter((event) => {
            return event.blockNumber !== lastHandledBlock;
          });
        };
        this.durationConfig.eth.pending.locks = filterPendingEvents(
          ethLockPendingEvents,
          this.durationConfig.eth.lastHandledBlock,
        ) as EthLockRecord[];
        this.durationConfig.eth.pending.unlocks = filterPendingEvents(
          ethUnlockPendingEvents,
          this.durationConfig.eth.lastHandledBlock,
        ) as EthUnlockRecord[];
        this.durationConfig.ckb.pending.mints = filterPendingEvents(
          ckbMintPendingEvents,
          this.durationConfig.ckb.lastHandledBlock,
        ) as CkbMintRecord[];
        this.durationConfig.ckb.pending.burns = filterPendingEvents(
          ckbBurnPendingEvents,
          this.durationConfig.ckb.lastHandledBlock,
        ) as CkbBurnRecord[];

        const filterExpiredEvents = (expiredItems: eventItem[], lastHandledBlock: number): monitorEvent[] => {
          return expiredItems
            .filter((item) => {
              return item.event.blockNumber != lastHandledBlock;
            })
            .map((item) => item.event);
        };

        this.durationConfig.eth.expired.locks = filterExpiredEvents(
          ethLockExpiredEvents,
          this.durationConfig.eth.lastHandledBlock,
        ) as EthLockRecord[];
        this.durationConfig.eth.expired.unlocks = filterExpiredEvents(
          ethUnlockExpiredEvents,
          this.durationConfig.eth.lastHandledBlock,
        ) as EthUnlockRecord[];
        this.durationConfig.ckb.expired.mints = filterExpiredEvents(
          ckbMintExpiredEvents,
          this.durationConfig.ckb.lastHandledBlock,
        ) as CkbMintRecord[];
        this.durationConfig.ckb.expired.burns = filterExpiredEvents(
          ckbBurnExpiredEvents,
          this.durationConfig.ckb.lastHandledBlock,
        ) as CkbBurnRecord[];

        writeMonitorConfig(this.durationConfig);

        const recordsNum = {
          ethLockNum: this.ethLockCache.length(),
          ethUnlockNum: this.ethUnlockCache.length(),
          ckbMintNum: this.ckbMintCache.length(),
          ckbBurnNum: this.ckbBurnCache.length(),
        };
        const recordsNumStr = JSON.stringify(recordsNum);
        logger.info(`Monitor records number in cache:${recordsNumStr}`);

        const lastHandledBlock = {
          eth: this.durationConfig.eth.lastHandledBlock,
          ckb: this.durationConfig.ckb.lastHandledBlock,
        };
        if (!isExpiredEventSend) {
          const ethTipBlockNumber = await this.ethProvider.getBlockNumber();
          const ckbTipBlockNumber = await ForceBridgeCore.ckb.rpc.getTipBlockNumber();

          const tipBlockNumber = {
            eth: ethTipBlockNumber,
            ckb: Number(ckbTipBlockNumber),
          };

          await new WebHook()
            .setTitle(`Monitor Summary - ${ForceBridgeCore.config.monitor!.env}`)
            .setDescription(
              `Records number in cache:${recordsNumStr} \n LastHandledBlock:${JSON.stringify(
                lastHandledBlock,
              )} \n Tip block number :${JSON.stringify(tipBlockNumber)}`,
            )
            .addTimeStamp()
            .success()
            .send();
        }
      },
      {
        onRejectedInterval: 5000,
        onResolvedInterval: expiredCheckInterval,
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
        for (const record of ckbEventRecords) {
          if ((record as CkbMintRecord).fromTxId) {
            await this.onCkbMintRecord(record);
          } else {
            await this.onCkbBurnRecord(record as unknown as CkbBurnRecord);
          }
          this.durationConfig.ckb.lastHandledBlock = record.blockNumber!;
        }

        this.ckbLastScannedBlock = toBlock;
        if (ckbEventRecords.length === 0) {
          this.durationConfig.ckb.lastHandledBlock = toBlock;
        }

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
        for (const record of ethMonitorRecords) {
          if ((record as EthUnlockRecord).fromTxId) {
            await this.onEthUnlockRecord(record);
          } else {
            await this.onEthLockRecord(record as EthLockRecord);
          }
          this.durationConfig.eth.lastHandledBlock = record.blockNumber;
        }

        this.ethLastScannedBlock = toBlock;
        if (ethMonitorRecords.length === 0) {
          this.durationConfig.eth.lastHandledBlock = toBlock;
        }

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

export async function startMonitor(configPath: string): Promise<void> {
  await bootstrap(configPath);
  const monitor = new Monitor(createETHRecordObservable(), createCKBRecordObservable());
  await monitor.start();
}
