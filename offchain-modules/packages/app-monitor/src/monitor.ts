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
import { Duration, EventItem, monitorEvent, NewDurationCfg, readMonitorConfig, writeMonitorConfig } from './duration';

let step = 100;
let expiredTime = 1200 * 1000;
let expiredCheckInterval = 10 * 1000;

function newEvent(event: monitorEvent): EventItem {
  return {
    addTime: new Date().getTime(),
    event,
  };
}

function isExpired(event: EventItem): boolean {
  return new Date().getTime() - event.addTime >= expiredTime;
}

export class Monitor {
  private ethProvider: ethers.providers.JsonRpcProvider;
  private ownerTypeHash: string;
  private durationConfig: Duration;
  webHookInfoUrl: string;
  webHookErrorUrl: string;

  constructor(private ethRecordObservable: EthRecordObservable, private ckbRecordObservable: CKBRecordObservable) {
    this.webHookInfoUrl = ForceBridgeCore.config.monitor!.discordWebHook;
    this.webHookErrorUrl = ForceBridgeCore.config.monitor!.discordWebHookError || this.webHookInfoUrl;
    this.ethProvider = new ethers.providers.JsonRpcProvider(ForceBridgeCore.config.eth.rpcUrl);
    this.ownerTypeHash = getOwnerTypeHash();
  }

  async onEthLockRecord(lock: EthLockRecord): Promise<void> {
    logger.info(`Receive ethLock:${JSON.stringify(lock)}`);
    this.durationConfig.eth.pending.locks.set(lock.mintId, newEvent(lock));
  }

  async onEthUnlockRecord(unlock: EthUnlockRecord): Promise<void> {
    logger.info(`Receive ethUnlock:${JSON.stringify(unlock)}`);
    this.durationConfig.eth.pending.unlocks.set(unlock.fromTxId!, newEvent(unlock));
  }

  async onCkbMintRecord(mint: CkbMintRecord): Promise<void> {
    logger.info(`Receive ckbMint:${JSON.stringify(mint)}`);
    this.durationConfig.ckb.pending.mints.set(mint.fromTxId!, newEvent(mint));
  }

  async onCkbBurnRecord(burn: CkbBurnRecord): Promise<void> {
    logger.info(`Receive ckbBurn:${JSON.stringify(burn)}`);
    this.durationConfig.ckb.pending.burns.set(burn.txId, newEvent(burn));
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
    await new WebHook(this.webHookErrorUrl)
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
    await new WebHook(this.webHookErrorUrl)
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
    }, ForceBridgeCore.config.monitor!.expiredCheckInterval);
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
  }

  checkExpiredEvent(): void {
    foreverPromise(
      async () => {
        // compare and delete matched records
        for (const [id, lock] of this.durationConfig.eth.pending.locks) {
          const mint = this.durationConfig.ckb.pending.mints.get(id);
          if (!mint) {
            continue;
          }
          const compare = await this.compareEthLockAndCkbMint(lock.event as EthLockRecord, mint.event as CkbMintRecord);
          if (compare) {
            this.durationConfig.ckb.pending.mints.delete(id);
            this.durationConfig.eth.pending.locks.delete(id);
            this.durationConfig.ckb.matchCount.mint += 1;
            this.durationConfig.eth.matchCount.lock += 1;
          }
        }
        for (const [id, burn] of this.durationConfig.ckb.pending.burns) {
          const unlock = this.durationConfig.eth.pending.unlocks.get(id);
          if (!unlock) {
            continue;
          }
          const compare = await this.compareCkbBurnAndEthUnlock(
            burn.event as CkbBurnRecord,
            unlock.event as EthUnlockRecord,
          );
          if (compare) {
            this.durationConfig.eth.pending.unlocks.delete(id);
            this.durationConfig.ckb.pending.burns.delete(id);
            this.durationConfig.eth.matchCount.unlock += 1;
            this.durationConfig.ckb.matchCount.burn += 1;
          }
        }

        const expiredCheck = async (events: Map<string, EventItem>, msg: string): Promise<void> => {
          for (const event of Array.from(events.values())) {
            if (!isExpired(event)) {
              continue;
            }
            const detail = JSON.stringify(event);
            logger.error(msg, detail);
            await new WebHook(this.webHookErrorUrl)
              .setTitle(msg + ` - ${ForceBridgeCore.config.monitor!.env}`)
              .setDescription(detail)
              .addTimeStamp()
              .error()
              .send();
          }
        };

        await expiredCheck(this.durationConfig.eth.pending.locks, 'ETH lock timeout');
        await expiredCheck(this.durationConfig.eth.pending.unlocks, 'ETH unlock timeout');
        await expiredCheck(this.durationConfig.ckb.pending.mints, 'CKB mint timeout');
        await expiredCheck(this.durationConfig.ckb.pending.burns, 'CKB burn timeout');

        writeMonitorConfig(this.durationConfig);
        await this.sendSummary();
      },
      {
        onRejectedInterval: expiredCheckInterval,
        onResolvedInterval: expiredCheckInterval,
        onRejected: (e: Error) => {
          logger.error(`Monitor observeEthLock error:${e.stack}`);
        },
      },
    );
  }

  async sendSummary(): Promise<void> {
    const recordsNum = {
      ethLockNum: this.durationConfig.eth.pending.locks.size,
      ethUnlockNum: this.durationConfig.eth.pending.unlocks.size,
      ckbMintNum: this.durationConfig.ckb.pending.mints.size,
      ckbBurnNum: this.durationConfig.ckb.pending.burns.size,
    };

    const lastHandledBlock = {
      eth: this.durationConfig.eth.lastHandledBlock,
      ckb: this.durationConfig.ckb.lastHandledBlock,
    };

    const tipBlockNumber = {
      eth: await this.ethProvider.getBlockNumber(),
      ckb: Number(await ForceBridgeCore.ckb.rpc.getTipBlockNumber()),
    };

    const matchCount = {
      ethUnlock: this.durationConfig.eth.matchCount.unlock,
      ckbBurn: this.durationConfig.ckb.matchCount.burn,
      ckbMint: this.durationConfig.ckb.matchCount.mint,
      ethLock: this.durationConfig.eth.matchCount.lock,
    };

    logger.info(
      `LastHandledBlock:${JSON.stringify(lastHandledBlock)} Tip block number :${JSON.stringify(
        tipBlockNumber,
      )} Match count:${JSON.stringify(matchCount)} Records number in cache:${JSON.stringify(recordsNum)} `,
    );
    await new WebHook(this.webHookInfoUrl)
      .setTitle(`Monitor Summary - ${ForceBridgeCore.config.monitor!.env}`)
      .addField('LastHandledBlock', JSON.stringify(lastHandledBlock))
      .addField('Tip block number', JSON.stringify(tipBlockNumber))
      .addField('Match count', JSON.stringify(matchCount))
      .addField('Records number in cache', JSON.stringify(recordsNum))
      .addTimeStamp()
      .success()
      .send();
  }

  async observeCkbEvent(): Promise<void> {
    foreverPromise(
      async () => {
        const fromBlockNum = this.durationConfig.ckb.lastHandledBlock + 1;
        let toBlockNum =
          Number(await ForceBridgeCore.ckb.rpc.getTipBlockNumber()) - ForceBridgeCore.config.ckb.confirmNumber;
        // no new block yet, return
        if (toBlockNum <= fromBlockNum) {
          await asyncSleep(15000);
          return;
        }
        // set the max step
        if (fromBlockNum + step < toBlockNum) {
          toBlockNum = fromBlockNum + step;
        }

        logger.info(`Monitor observeCkbEvent fromBlock: ${fromBlockNum} toBlock: ${toBlockNum}`);

        const fromBlock = '0x' + fromBlockNum.toString(16);
        // ckb toBlock in exclusive while eth is inclusive
        const toBlock = '0x' + (toBlockNum + 1).toString(16);

        await this.ckbRecordObservable
          .observeMintRecord({ fromBlock, toBlock })
          .subscribe((record) => this.onCkbMintRecord(record));

        await this.ckbRecordObservable
          .observeBurnRecord({
            fromBlock,
            toBlock,
            filterRecipientData: (data) => {
              const recipientOwnerCellTypeHash = '0x' + Buffer.from(data.getOwnerCellTypeHash().raw()).toString('hex');
              return recipientOwnerCellTypeHash === getOwnerTypeHash();
            },
          })
          .subscribe((record) => this.onCkbBurnRecord(record));

        this.durationConfig.ckb.lastHandledBlock = toBlockNum;
      },
      {
        onRejectedInterval: 15000,
        onResolvedInterval: 0,
        onRejected: (e: Error) => {
          logger.error(`Monitor observeCkbLock error:${e.stack}`);
        },
      },
    );
  }

  async observeEthEvent(): Promise<void> {
    foreverPromise(
      async () => {
        const fromBlock = this.durationConfig.eth.lastHandledBlock + 1;
        let toBlock = (await this.ethProvider.getBlockNumber()) - ForceBridgeCore.config.eth.confirmNumber;
        // no new block yet, return
        if (toBlock <= fromBlock) {
          await asyncSleep(15000);
          return;
        }
        // set the max step
        if (fromBlock + step < toBlock) {
          toBlock = fromBlock + step;
        }

        logger.info(`Monitor observeEthEvent fromBlock: ${fromBlock} toBlock: ${toBlock}`);

        await this.ethRecordObservable
          .observeLockRecord({}, { fromBlock: fromBlock, toBlock: toBlock })
          .subscribe((record) => this.onEthLockRecord(record));

        await this.ethRecordObservable
          .observeUnlockRecord({}, { fromBlock: fromBlock, toBlock: toBlock })
          .subscribe((record) => this.onEthUnlockRecord(record));

        this.durationConfig.eth.lastHandledBlock = toBlock;
      },
      {
        onRejectedInterval: 15000,
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
  logger.info('start monitor');
  const monitor = new Monitor(createETHRecordObservable(), createCKBRecordObservable());
  await monitor.start();
}
