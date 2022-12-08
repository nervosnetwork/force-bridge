import { parseAddress } from '@ckb-lumos/helpers';
import { CkbBurnRecord, CkbMintRecord, EthLockRecord, EthUnlockRecord, SudtRecord } from '@force-bridge/reconc/dist';
import { nonNullable } from '@force-bridge/x';
import { IndexerCollector } from '@force-bridge/x/dist/ckb/tx-helper/collector';
import { getOwnerTypeHash } from '@force-bridge/x/dist/ckb/tx-helper/multisig/multisig_helper';
import { verifierEndpoint, feeAccounts } from '@force-bridge/x/dist/config';
import { bootstrap, ForceBridgeCore } from '@force-bridge/x/dist/core';
import { KVDb } from '@force-bridge/x/dist/db/kv';
import { SudtDb } from '@force-bridge/x/dist/db/sudt';
import { CKBRecordObservable } from '@force-bridge/x/dist/reconc';
import { asyncSleep, foreverPromise, getDBConnection } from '@force-bridge/x/dist/utils';
import { logger } from '@force-bridge/x/dist/utils/logger';
import {
  createCKBRecordObservable,
  createETHRecordObservable,
  EthRecordObservable,
} from '@force-bridge/xchain-eth/dist/reconc';
import axios from 'axios';
import dayjs from 'dayjs';
import { ethers } from 'ethers';
import { assetListPriceChange } from './assetPrice';
import { BalanceProvider } from './balanceProvider';
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

interface GasPriceTicker {
  time: number;
  price: number;
}

class GasPriceRecorder {
  private averageSeconds: number;
  private riseRate: number;
  private continueSeconds: number;
  private tickers: Array<GasPriceTicker>;
  private startRiseTime?: number;

  public constructor(averageSeconds: number, riseRate: number, continueSeconds: number) {
    this.averageSeconds = averageSeconds;
    this.riseRate = riseRate;
    this.continueSeconds = continueSeconds;
    this.tickers = new Array<GasPriceTicker>();
  }

  public async put(time: number, price: number): Promise<string> {
    const avgPrice =
      this.tickers.map((ticker) => ticker.price).reduce((sum, price) => sum + price, 0) / this.tickers.length;
    let allRight = true;
    if (avgPrice > 0 && price > avgPrice * (1 + this.riseRate)) {
      if (this.startRiseTime) {
        if (time - this.startRiseTime >= this.continueSeconds) {
          allRight = false;
        }
      } else {
        this.startRiseTime = time;
      }
    } else if (this.startRiseTime) {
      this.startRiseTime = undefined;
    }
    this.tickers.push({ time, price });
    while (time - this.tickers[0].time > this.averageSeconds) {
      this.tickers.shift();
    }
    if (allRight) {
      return '';
    } else {
      return `average gas price in last ${this.averageSeconds} seconds: ${avgPrice} current gas price: ${price}`;
    }
  }
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
  private gasPriceRecorder: GasPriceRecorder;
  private balanceProvider: BalanceProvider;
  private sudtDb: SudtDb;
  private kvDb: KVDb;
  webHookInfoUrl: string;
  webHookErrorUrl: string;

  constructor(private ethRecordObservable: EthRecordObservable, private ckbRecordObservable: CKBRecordObservable) {
    this.webHookInfoUrl = ForceBridgeCore.config.monitor!.discordWebHook;
    this.webHookErrorUrl = ForceBridgeCore.config.monitor!.discordWebHookError || this.webHookInfoUrl;
    this.ethProvider = new ethers.providers.JsonRpcProvider(ForceBridgeCore.config.eth.rpcUrl);
    this.ownerTypeHash = getOwnerTypeHash();
    if (ForceBridgeCore.config.monitor!.gasPrice) {
      const gasPriceConfig = nonNullable(ForceBridgeCore.config.monitor!.gasPrice);
      this.gasPriceRecorder = new GasPriceRecorder(
        gasPriceConfig.averageSeconds,
        gasPriceConfig.riseRate,
        gasPriceConfig.continueSeconds,
      );
    }
    this.balanceProvider = new BalanceProvider(
      ForceBridgeCore.config.eth.rpcUrl,
      ForceBridgeCore.config.ckb.ckbRpcUrl,
      ForceBridgeCore.config.ckb.ckbIndexerUrl,
    );
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

  async onSudtRecord(record: SudtRecord): Promise<void> {
    logger.info(`Receive sudt:${JSON.stringify(record)}`);
    try {
      await this.sudtDb.createSudtTransferRecord(
        record.txId,
        record.direction,
        record.lock,
        record.token,
        record.amount,
        record.index,
      );
    } catch (e) {
      logger.error(e.stack);
    }
  }

  async onCkbBurnRecord(burn: CkbBurnRecord): Promise<void> {
    logger.info(`Receive ckbBurn:${JSON.stringify(burn)}`);
    this.durationConfig.ckb.pending.burns.set(burn.txId, newEvent(burn));
  }

  async compareEthLockAndCkbMint(lock: EthLockRecord, mint: CkbMintRecord): Promise<boolean> {
    const checker = (lock: EthLockRecord, mint: CkbMintRecord): string => {
      const lockRecipientLockscript = parseAddress(lock.recipient);
      const mintRecipientLockscript = parseAddress(mint.recipient);
      if (
        lockRecipientLockscript.args !== mintRecipientLockscript.args ||
        lockRecipientLockscript.hash_type !== mintRecipientLockscript.hash_type ||
        lockRecipientLockscript.code_hash !== mintRecipientLockscript.code_hash
      ) {
        return `lock.recipient:${lock.recipient} != mint.recipient:${mint.recipient}`;
      }
      // const fee = new EthAsset(lock.token, this.ownerTypeHash).getBridgeFee('in');
      // if (!new BigNumber(lock.amount).eq(new BigNumber(fee).plus(new BigNumber(mint.amount)))) {
      //   return `mint.amount:${mint.amount} + fee:${fee} != lock.amount:${lock.amount}`;
      // }
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
      // if (!new BigNumber(burn.amount).eq(new BigNumber(unlock.fee!).plus(new BigNumber(unlock.amount)))) {
      //   return `burn.amount:${burn.amount} != unlock.amount:${unlock.amount} + fee:${unlock.fee}`;
      // }
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
    void this.reconcSudtBill();
    // this.observeAssetPrice().catch((err) => {
    //   logger.error(`Monitor observeAssetPrice error:${err.stack}`);
    // });
    setTimeout(() => {
      this.checkExpiredEvent();
    }, ForceBridgeCore.config.monitor!.expiredCheckInterval);

    setTimeout(() => {
      this.checkOvermintEvent();
    }, ForceBridgeCore.config.monitor!.overmintCheckInterval);

    if (ForceBridgeCore.config.monitor!.gasPrice) {
      setTimeout(() => {
        this.checkGasPriceEvent();
      }, ForceBridgeCore.config.monitor!.gasPrice.fetchIntervalSeconds * 1000);
    }
  }

  async reconcSudtBill(): Promise<void> {
    let fromBlock = this.durationConfig.ckb.sudtBillLastReconcBlock;
    let toBlock = fromBlock + 100;
    while (fromBlock < this.durationConfig.ckb.sudtBillReconcBlock) {
      toBlock > this.durationConfig.ckb.sudtBillReconcBlock ? this.durationConfig.ckb.sudtBillReconcBlock : toBlock;
      try {
        logger.info(`Monitor reconcSudtBill fromBlock: ${fromBlock} toBlock: ${toBlock}`);
        await this.ckbRecordObservable
          .observeSudtRecord({ fromBlock: `0x${fromBlock.toString(16)}`, toBlock: `0x${toBlock.toString(16)}` })
          .subscribe((records) => {
            records.forEach((record) => {
              void this.onSudtRecord(record);
            });
          });
      } catch (e) {
        logger.error(e.stack);
      }
      try {
        await this.kvDb.set('sudt_bill_last_handle_block', toBlock.toString());
      } catch (e) {
        logger.error(e.stack);
      }
      fromBlock = toBlock + 1;
      toBlock = fromBlock + 100;
      await asyncSleep(10);
    }
  }

  async init(): Promise<void> {
    const conn = await getDBConnection();
    this.sudtDb = new SudtDb(conn);
    this.kvDb = new KVDb(conn);
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

    this.durationConfig.ckb.sudtBillReconcBlock = parseInt(
      (await this.kvDb.get('sudt_bill_reconc_handle_block')) ?? '0',
    );
    if (this.durationConfig.ckb.sudtBillReconcBlock == 0) {
      await this.kvDb.set('sudt_bill_reconc_handle_block', this.durationConfig.ckb.lastHandledBlock.toString());
      this.durationConfig.ckb.sudtBillReconcBlock = this.durationConfig.ckb.lastHandledBlock;
    }

    this.durationConfig.ckb.sudtBillLastReconcBlock = parseInt(
      (await this.kvDb.get('sudt_bill_last_handle_block')) ?? '0',
    );
    console.log(this.durationConfig);
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
      accountsFeeInfo = `ckb addr: ${accountsFee.ckbAddr}
      balance: ${Number(accountsFee.ckb) / 10 ** 8} CKB
      eth addr: ${accountsFee.ethAddr}
      balance: ${Number(accountsFee.eth) / 10 ** 18} ETH`;
      let send = false;
      let hook = new WebHook(this.webHookErrorUrl).setTitle(`Fee Alarm - ${ForceBridgeCore.config.monitor!.env}`);
      if (accountsFee.ckb < accountsFee.ckbThreshold) {
        hook = hook.addField('ckb fee account', `addr: ${accounts.ckbAddr}, balance: ${accountsFee.ckb}`);
        logger.error(`${ForceBridgeCore.config.monitor!.env} ckb fee account balance is low: ${accountsFee.ckb}`);
        send = true;
      }
      if (accountsFee.eth < accountsFee.ethThreshold) {
        hook = hook.addField('eth fee account', `addr: ${accounts.ethAddr}, balance: ${accountsFee.eth}`);
        logger.error(`${ForceBridgeCore.config.monitor!.env} eth fee account balance is low: ${accountsFee.eth}`);
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

  checkGasPriceEvent(): void {
    foreverPromise(
      async () => {
        logger.info('start gasPrice check');
        const ethgasAPI = ForceBridgeCore.config.monitor!.gasPrice!.ethgasAPI;
        const ethgas = (await axios.get(ethgasAPI)).data;
        const now = dayjs();
        const errorMsg = await this.gasPriceRecorder.put(now.unix(), ethgas.average);
        if (errorMsg) {
          await new WebHook(this.webHookErrorUrl)
            .setTitle('gasPrice check error' + ` - ${ForceBridgeCore.config.monitor!.env}`)
            .setDescription(errorMsg)
            .addTimeStamp()
            .error()
            .send();
        }
      },
      {
        onRejectedInterval: ForceBridgeCore.config.monitor!.gasPrice!.fetchIntervalSeconds * 1000,
        onResolvedInterval: ForceBridgeCore.config.monitor!.gasPrice!.fetchIntervalSeconds * 1000,
        onRejected: (e: Error) => {
          logger.error(`Monitor checkGasPriceEvent error:${e.stack}`);
        },
      },
    );
  }

  checkOvermintEvent(): void {
    foreverPromise(
      async () => {
        logger.info('start overmint check');
        const contractAddress = ForceBridgeCore.config.eth.contractAddress;
        const balances = await Promise.all(
          ForceBridgeCore.config.eth.assetWhiteList.map(async (asset) => ({
            asset: asset,
            ethereumBalance:
              asset.address === '0x0000000000000000000000000000000000000000'
                ? await this.balanceProvider.ethBalance(contractAddress)
                : await this.balanceProvider.ethErc20Balance(contractAddress, asset.address, asset.name),
            nervosBalance: await this.balanceProvider.ckbSudtBalance(asset.address, asset.name),
          })),
        );
        logger.info(
          `overmint check balances: ${JSON.stringify(
            balances.map((balance) => ({
              name: balance.asset.name,
              ethereum: balance.ethereumBalance.toString(),
              nervos: balance.nervosBalance.toString(),
            })),
          )}`,
        );
        const overmintAssets = balances.filter((balance) => balance.nervosBalance > balance.ethereumBalance);
        if (overmintAssets.length > 0) {
          const errorMsg = `overmint check error: minted balance from nervos is greater than locked balance on ethereum ${overmintAssets.map(
            (asset) => `${asset.asset.name}: onNervos: ${asset.nervosBalance} > onEthereum: ${asset.ethereumBalance}`,
          )}`;
          await new WebHook(this.webHookErrorUrl)
            .setTitle('overmint check error' + ` - ${ForceBridgeCore.config.monitor!.env}`)
            .setDescription(errorMsg)
            .addTimeStamp()
            .error()
            .send();
          logger.error(errorMsg);
        }
      },
      {
        onRejectedInterval: ForceBridgeCore.config.monitor!.overmintCheckInterval,
        onResolvedInterval: ForceBridgeCore.config.monitor!.overmintCheckInterval,
        onRejected: (e: Error) => {
          logger.error(`Monitor checkOvermintEvent error:${e.stack}`);
        },
      },
    );
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

        await this.ckbRecordObservable.observeSudtRecord({ fromBlock, toBlock }).subscribe((records) => {
          records.forEach((record) => {
            void this.onSudtRecord(record);
          });
        });

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
    let continuousErrorCount = 0;
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
        continuousErrorCount = 0;
      },
      {
        onRejectedInterval: 15000,
        onResolvedInterval: 1000,
        onRejected: (e: Error) => {
          continuousErrorCount++;
          if (continuousErrorCount > 10) {
            logger.error(
              `Monitor observeEthLock error, continuousErrorCount: ${continuousErrorCount}, stack: ${e.stack}`,
            );
          } else {
            logger.warn(
              `Monitor observeEthLock error, continuousErrorCount: ${continuousErrorCount}, stack: ${e.stack}`,
            );
          }
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
