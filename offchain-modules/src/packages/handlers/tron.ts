import { TronDb } from '../db';
import { logger } from '../utils/logger';
import { asyncSleep } from '../utils';
import { ForceBridgeCore } from '../core';
import { ITronLock, TronUnlock, ICkbMint } from '@force-bridge/db/model';
import { ChainType } from '@force-bridge/ckb/model/asset';
import { getAssetTypeByAsset } from '@force-bridge/xchain/tron/utils';
const TronWeb = require('tronweb');
const TronGrid = require('trongrid');

type TronLockEvent = {
  tx_hash: string;
  index: number;
  sender: string;
  asset: string;
  amount: string;
  memo: string;
  timestamp: number;
};

export class TronHandler {
  private tronWeb;
  private tronGrid;
  private committee;
  constructor(private db: TronDb) {
    this.tronWeb = new TronWeb({ fullHost: ForceBridgeCore.config.tron.tronGridUrl });
    this.tronGrid = new TronGrid(this.tronWeb);
    this.committee = ForceBridgeCore.config.tron.committee;
  }

  private async getTrxAndTrc10LockEvents(min_timestamp: number): Promise<TronLockEvent[]> {
    const lockEvents: TronLockEvent[] = [];

    let fingerprint = '';
    while (fingerprint != null) {
      const txs = await this.tronGrid.account.getTransactions(this.committee.address, {
        only_to: true,
        only_confirmed: true,
        min_timestamp: min_timestamp,
        order_by: 'timestamp,asc',
        limit: 200,
        fingerprint: fingerprint,
      });
      for (const data of txs.data) {
        const asset_data = data.raw_data.contract[0].parameter.value;
        const event = {
          tx_hash: data.txID,
          index: 0,
          sender: this.tronWeb.address.fromHex(asset_data.owner_address),
          asset: asset_data.asset_name ? asset_data.asset_name : 'trx',
          amount: asset_data.amount,
          memo: data.raw_data.data ? this.tronWeb.toUtf8(data.raw_data.data) : 'no memo',
          timestamp: data.block_timestamp,
        };
        lockEvents.push(event);
      }
      fingerprint = txs.meta.fingerprint;
    }
    return lockEvents;
  }

  private async getTrc20TxsLockEvents(min_timestamp: number): Promise<TronLockEvent[]> {
    const lockEvents: TronLockEvent[] = [];

    let fingerprint = '';
    while (fingerprint != null) {
      const txs = await this.tronGrid.account.getTrc20Transactions(this.committee.address, {
        only_confirmed: true,
        only_to: true,
        min_timestamp: min_timestamp,
        order_by: 'timestamp,asc',
        limit: 200,
        fingerprint: fingerprint,
      });
      for (const data of txs.data) {
        if (Object.keys(data.token_info).length == 0) {
          logger.warn(
            `TronHandler getTrc20TxsLockEvents invalid trc20 tx, token info is undefined, data:${JSON.stringify(
              data,
              null,
              2,
            )}`,
          );
          continue;
        }
        const tx = await this.tronWeb.trx.getTransaction(data.transaction_id);
        const event = {
          tx_hash: data.transaction_id,
          index: 0,
          sender: data.from,
          asset: this.tronWeb.address.fromHex(data.token_info).address,
          amount: data.value,
          memo: this.tronWeb.toUtf8(tx.raw_data.data),
          timestamp: data.block_timestamp,
        };
        lockEvents.push(event);
      }
      fingerprint = txs.meta.fingerprint;
    }
    return lockEvents;
  }

  // memo style should be "ckb_recipient,sudt_extra_data"
  private analyzeMemo(memo: string) {
    const splitted = memo.split(',', 2);
    const ckbRecipient = splitted[0];
    const sudtExtraData = splitted[1];

    return { ckbRecipient, sudtExtraData };
  }

  private transferEventToCkbMint(event: TronLockEvent) {
    const { ckbRecipient, sudtExtraData } = this.analyzeMemo(event.memo);
    return {
      id: event.tx_hash.concat('_').concat(event.index.toString()),
      chain: ChainType.TRON,
      asset: event.asset,
      amount: event.amount,
      recipientLockscript: ckbRecipient,
      sudtExtraData: sudtExtraData,
    };
  }

  private transferEventToTronLock(event: TronLockEvent): ITronLock {
    const tronLock: ITronLock = {
      txHash: event.tx_hash,
      txIndex: 0,
      sender: event.sender,
      asset: event.asset,
      assetType: getAssetTypeByAsset(event.asset),
      amount: event.amount,
      memo: event.memo,
      timestamp: event.timestamp,
    };
    return tronLock;
  }

  // listen Tron chain and handle the new lock events
  async watchLockEvents(): Promise<void> {
    let startTimestamp = Date.now();
    const lastTimestamp = await this.db.getLatestTimestamp();
    if (lastTimestamp != 1) {
      startTimestamp = lastTimestamp;
    }
    logger.info('TronHandler watchLockEvents start time:', startTimestamp);

    let minTimestamp = startTimestamp;

    while (true) {
      try {
        logger.debug(`TronHandler watchLockEvents minTimestamp:${minTimestamp}`);

        const ckbMintRecords: ICkbMint[] = [];
        const tronLockRecords: ITronLock[] = [];
        const trxAndTrc10Events = await this.getTrxAndTrc10LockEvents(minTimestamp);
        const trc20LockEvents = await this.getTrc20TxsLockEvents(minTimestamp);
        const totalLockEvents = trxAndTrc10Events.concat(trc20LockEvents);

        for (const event of totalLockEvents) {
          if (event.timestamp <= minTimestamp) {
            continue;
          }
          logger.info(`TronHandler watchLockEvents newLockEvent:${JSON.stringify(event, null, 2)}`);
          const ckbMint = this.transferEventToCkbMint(event);
          ckbMintRecords.push(ckbMint);
          const tronLock = this.transferEventToTronLock(event);
          tronLockRecords.push(tronLock);
        }

        await this.db.createCkbMint(ckbMintRecords);
        await this.db.createTronLock(tronLockRecords);

        if (trxAndTrc10Events.length != 0) {
          minTimestamp = Math.max(trxAndTrc10Events[trxAndTrc10Events.length - 1].timestamp, minTimestamp);
        }
        if (trc20LockEvents.length != 0) {
          minTimestamp = Math.max(trc20LockEvents[trc20LockEvents.length - 1].timestamp, minTimestamp);
        }
        await asyncSleep(3000);
      } catch (e) {
        logger.error('TronHandler watchLockEvents error:', e.toString());
        await asyncSleep(3000);
      }
    }
  }

  private async multiSignTransferTrx(unlockRecord: TronUnlock) {
    const from = this.committee.address;
    const to = unlockRecord.recipientAddress;
    const amount = +unlockRecord.amount;
    const memo = unlockRecord.memo;
    const unsigned_tx = await this.tronWeb.transactionBuilder.sendTrx(to, amount, from, {
      permissionId: this.committee.permissionId,
    });

    const unsignedWithMemoTx = await this.tronWeb.transactionBuilder.addUpdateData(unsigned_tx, memo, 'utf8');

    let signed_tx = unsignedWithMemoTx;
    for (const key of this.committee.keys) {
      signed_tx = await this.tronWeb.trx.multiSign(signed_tx, key);
    }

    return signed_tx;
  }

  private async multiSignTransferTrc10(unlockRecord: TronUnlock) {
    const from = this.committee.address;
    const to = unlockRecord.recipientAddress;
    const amount = unlockRecord.amount;
    const tokenID = unlockRecord.asset;
    const memo = unlockRecord.memo;
    const unsigned_tx = await this.tronWeb.transactionBuilder.sendToken(to, amount, tokenID, from, {
      permissionId: this.committee.permissionId,
    });

    const unsignedWithMemoTx = await this.tronWeb.transactionBuilder.addUpdateData(unsigned_tx, memo, 'utf8');

    let signed_tx = unsignedWithMemoTx;
    for (const key of this.committee.keys) {
      signed_tx = await this.tronWeb.trx.multiSign(signed_tx, key);
    }
    return signed_tx;
  }

  private async multiSignTransferTrc20(unlockRecord: TronUnlock) {
    const from = this.committee.address;
    const to = unlockRecord.recipientAddress;
    const amount = unlockRecord.amount;
    const trc20ContractAddress = unlockRecord.asset;
    const memo = unlockRecord.memo;

    const options = {
      permissionId: this.committee.permissionId,
      feeLimit: ForceBridgeCore.config.tron.feeLimit,
    };
    const functionSelector = 'transfer(address,uint256)';
    const params = [
      { type: 'address', value: to },
      { type: 'uint256', value: amount },
    ];

    const unsigned_tx = await this.tronWeb.transactionBuilder.triggerSmartContract(
      trc20ContractAddress,
      functionSelector,
      options,
      params,
      from,
    );
    const unsignedWithMemoTx = await this.tronWeb.transactionBuilder.addUpdateData(
      unsigned_tx.transaction,
      memo,
      'utf8',
    );

    let signed_tx = unsignedWithMemoTx;
    for (const key of this.committee.keys) {
      signed_tx = await this.tronWeb.trx.multiSign(signed_tx, key);
    }
    return signed_tx;
  }

  // watch the tron_unlock table and handle the new unlock events
  // send tx according to the data
  async watchUnlockEvents(): Promise<void> {
    while (true) {
      try {
        logger.debug('TronHandler watchUnlockEvents flush pending tx to confirm');
        const pendingRecords = await this.db.getTronUnlockRecords('pending');
        for (const pendingRecord of pendingRecords) {
          try {
            const confirmedTx = await this.tronWeb.trx.getConfirmedTransaction(pendingRecord.tronTxHash);
            console.log(confirmedTx);
            if (confirmedTx.ret[0].contractRet == 'SUCCESS') {
              pendingRecord.status = 'success';
            } else {
              pendingRecord.status = 'error';
            }
            logger.info(
              `TronHandler watchUnlockEvents tronTxHash:${pendingRecord.tronTxHash} status:${pendingRecord.status}`,
            );
          } catch (e) {
            logger.debug(
              `TronHandler watchUnlockEvents getConfirmedTransaction error:${e.toString()}, ${
                pendingRecord.tronTxHash
              } not confirmed yet`,
            );
          }
        }
        await this.db.saveTronUnlock(pendingRecords);

        const unlockRecords = await this.db.getTronUnlockRecords('todo');
        for (const unlockRecord of unlockRecords) {
          logger.info(`TronHandler watchUnlockEvents getTronUnlockRecord:${JSON.stringify(unlockRecord, null, 2)}`);

          let signedTx;
          switch (unlockRecord.assetType) {
            case 'trx':
              signedTx = await this.multiSignTransferTrx(unlockRecord);
              break;
            case 'trc10':
              signedTx = await this.multiSignTransferTrc10(unlockRecord);
              break;
            case 'trc20':
              signedTx = await this.multiSignTransferTrc20(unlockRecord);
              break;
          }
          logger.debug('TronHandler watchUnlockEvents tron unlock signed tx:', signedTx);

          unlockRecord.tronTxHash = signedTx.txID;
          unlockRecord.tronTxIndex = 0;
          unlockRecord.status = 'pending';

          await this.db.saveTronUnlock([unlockRecord]);

          try {
            const broadTx = await this.tronWeb.trx.broadcast(signedTx);
            if (broadTx.result == true) {
              logger.info('TronHandler watchUnlockEvents broad tx success ', broadTx);
            } else {
              throw new Error(`broad tx failed ${broadTx}`);
            }
          } catch (e) {
            logger.error(
              `TronHandler watchUnlockEvents broadcast tx ${signedTx} error: ${e.toString()} ckbTxHash:${
                unlockRecord.ckbTxHash
              }`,
            );
            unlockRecord.status = 'error';
            unlockRecord.message = `tx error: ${e}`;
            await this.db.saveTronUnlock([unlockRecord]);
          }
        }
        await asyncSleep(3000);
      } catch (e) {
        logger.error('TronHandler watchUnlockEvents error:', e.toString());
        setTimeout(this.watchLockEvents, 3000);
      }
    }
  }

  start() {
    this.watchLockEvents();
    this.watchUnlockEvents();
    logger.info('tron handler started  🚀');
  }
}
