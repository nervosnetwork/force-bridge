import { parseAddress } from '@ckb-lumos/helpers';
import { CkbBurnRecord, CkbMintRecord, EthLockRecord, EthUnlockRecord } from '@force-bridge/reconc/dist';
import { EthAsset } from '@force-bridge/x/dist/ckb/model/asset';
import { IndexerCollector } from '@force-bridge/x/dist/ckb/tx-helper/collector';
import { getOwnerTypeHash } from '@force-bridge/x/dist/ckb/tx-helper/multisig/multisig_helper';
import { verifierEndpoint, feeAccounts } from '@force-bridge/x/dist/config';
import { bootstrap, ForceBridgeCore } from '@force-bridge/x/dist/core';
import { CKBRecordObservable } from '@force-bridge/x/dist/reconc';
import { asyncSleep, foreverPromise } from '@force-bridge/x/dist/utils';
import { logger } from '@force-bridge/x/dist/utils/logger';
import {
  createCKBRecordObservable,
  createETHRecordObservable,
  EthRecordObservable,
} from '@force-bridge/xchain-eth/dist/reconc';
import axios from 'axios';
import { BigNumber } from 'bignumber.js';
import { ethers } from 'ethers';
import { assetListPriceChange } from './assetPrice';
import { WebHook } from './discord';
import { Duration, EventItem, monitorEvent, NewDurationCfg, readMonitorConfig, writeMonitorConfig } from './duration';

let step = 100;
let expiredTime = 1200 * 1000;
let expiredCheckInterval = 10 * 1000;

const ONE_HOUR = 60 * 60 * 1000;

export interface VerifierStatus {
  name: string;
  error: boolean;
  status: string;
}

export interface feeStatus {
  ckbAddr: string;
  ethAddr: string;
  ckb: bigint;
  eth: bigint;
  ckbThreshold: bigint;
  ethThreshold: bigint;
}

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
    // this.observeAssetPrice().catch((err) => {
    //   logger.error(`Monitor observeAssetPrice error:${err.stack}`);
    // });
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

    // check verifiers status
    const verifiersStatus = await this.checkVerifiersStatus(ForceBridgeCore.config.monitor!.verifierEndpoints || []);
    for (const vs of verifiersStatus) {
      if (vs.error) {
        await new WebHook(this.webHookErrorUrl)
          .setTitle(`Verifier Status Error - ${ForceBridgeCore.config.monitor!.env}`)
          .addField('verifier status', JSON.stringify(vs))
          .addTimeStamp()
          .error()
          .send();
      }
    }

    // check accounts fee
    let accountsFeeInfo = 'no data';
    const accounts = ForceBridgeCore.config.monitor!.feeAccounts;
    if (accounts) {
      const accountsFee = await this.checkAccountsFee(accounts);
      accountsFeeInfo = `ckb addr: ${accountsFee.ckbAddr}, balance: ${accountsFee.ckb}\neth addr: ${accountsFee.ethAddr}, balance: ${accountsFee.eth}`;
      let send = false;
      let hook = new WebHook(this.webHookErrorUrl).setTitle(`Fee Alarm - ${ForceBridgeCore.config.monitor!.env}`);
      if (accountsFee.ckb < accountsFee.ckbThreshold) {
        hook = hook.addField('ckb fee account', `addr: ${accounts.ckbAddr}, balance: ${accountsFee.ckb}`);
        send = true;
      }
      if (accountsFee.eth < accountsFee.ethThreshold) {
        hook = hook.addField('eth fee account', `addr: ${accounts.ethAddr}, balance: ${accountsFee.eth}`);
        send = true;
      }
      if (send) {
        await hook.addTimeStamp().error().send();
      }
    }

    logger.info(
      `LastHandledBlock:${JSON.stringify(lastHandledBlock)},
      Tip block number :${JSON.stringify(tipBlockNumber)},
      Match count:${JSON.stringify(matchCount)},
      Records number in cache:${JSON.stringify(recordsNum)},
      Verifiers Status: ${JSON.stringify(verifiersStatus)},
      Fee Accounts: ${accountsFeeInfo}
      `,
    );
    await new WebHook(this.webHookInfoUrl)
      .setTitle(`Monitor Summary - ${ForceBridgeCore.config.monitor!.env}`)
      .addField('LastHandledBlock', JSON.stringify(lastHandledBlock))
      .addField('Tip block number', JSON.stringify(tipBlockNumber))
      .addField('Match count', JSON.stringify(matchCount))
      .addField('Records number in cache', JSON.stringify(recordsNum))
      .addField('Verifiers Status', JSON.stringify(verifiersStatus))
      .addField('Fee Accounts', accountsFeeInfo)
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

  async observeAssetPrice(): Promise<void> {
    foreverPromise(
      async () => {
        const priceAlertResult = await assetListPriceChange(ForceBridgeCore.config.eth.assetWhiteList);
        if (priceAlertResult.length == 0) {
          return;
        }
        logger.info(`Price fluctuation triggers an alert  :${JSON.stringify(priceAlertResult)}`);
        await new WebHook(this.webHookInfoUrl)
          .setTitle(`Bridge Fee Need Change  - ${ForceBridgeCore.config.monitor!.env}`)
          .addField('Price info', JSON.stringify(priceAlertResult))
          .addTimeStamp()
          .warning()
          .send();
      },
      {
        onRejectedInterval: expiredCheckInterval,
        onResolvedInterval: ONE_HOUR,
        onRejected: (e: Error) => {
          logger.error(`Monitor observeAssetPrice :${e.stack}`);
        },
      },
    );
  }

  async checkAccountsFee(accounts: feeAccounts): Promise<feeStatus> {
    const ethBalance = (await this.ethProvider.getBalance(accounts.ethAddr)).toBigInt();
    const lock = parseAddress(accounts.ckbAddr);
    const collector = new IndexerCollector(ForceBridgeCore.ckbIndexer);
    const ckbBalance = await collector.getBalance(lock);
    return {
      ckb: ckbBalance,
      eth: ethBalance,
      ckbThreshold: BigInt(accounts.ckbThreshold),
      ethThreshold: BigInt(accounts.ethThreshold),
      ckbAddr: accounts.ckbAddr,
      ethAddr: accounts.ethAddr,
    };
  }

  async checkVerifiersStatus(endpoints: verifierEndpoint[]): Promise<VerifierStatus[]> {
    const ethHeight = await this.ethProvider.getBlockNumber();
    const ckbHeight = Number(await ForceBridgeCore.ckb.rpc.getTipBlockNumber());
    const heightGapThreshold = 30;
    const res: VerifierStatus[] = [];
    for (const endpoint of endpoints) {
      const verifierStatus = {
        name: endpoint.name,
        error: false,
        status: '',
      };
      try {
        const param = {
          id: 0,
          jsonrpc: '2.0',
          method: 'status',
        };
        const response = (await axios.post(endpoint.url, param)).data.result;
        logger.debug(`endpoint: ${JSON.stringify(endpoint)}, res: ${JSON.stringify(response)}`);
        const verifierCkbHeight = response.latestChainStatus.ckb.latestCkbHeight;
        const verifierEthHeight = response.latestChainStatus.eth.latestEthHeight;
        if (ckbHeight - verifierCkbHeight > heightGapThreshold || ethHeight - verifierEthHeight > heightGapThreshold) {
          verifierStatus.error = true;
        }
        verifierStatus.status = `ckb: ${ckbHeight - verifierCkbHeight}, eth: ${ethHeight - verifierEthHeight}`;
      } catch (e) {
        logger.error(`fail to get verifier status, endpoint: ${JSON.stringify(endpoint)}, error: ${e.stack}`);
        verifierStatus.status = e.message;
        verifierStatus.error = true;
      }
      res.push(verifierStatus);
    }
    return res;
  }
}

export async function startMonitor(configPath: string): Promise<void> {
  await bootstrap(configPath);
  logger.info('start monitor');
  const monitor = new Monitor(createETHRecordObservable(), createCKBRecordObservable());
  await monitor.start();
}
