import { TronDb } from '../db';
import { logger } from '../utils/logger';
import { asyncSleep } from '../utils';
import { ForceBridgeCore } from '../core';
import { TronWeb } from 'tronweb';
import { TronGrid } from 'trongrid';
import { TronLock, TronUnlock, ICkbMint } from '@force-bridge/db/model';
import { ChainType } from '@force-bridge/ckb/model/asset';

type TronLockEvent = {
  tx_hash: string;
  index?: number;
  sender: string;
  asset: string;
  amount: string;
  memo: string;
  timestamp: number;
};

export class TronHandler {
  private tronWeb: TronWeb;
  private tronGrid: TronGrid;
  private committee;
  constructor(private db: TronDb) {
    this.tronWeb = new TronWeb({ fullHost: ForceBridgeCore.config.tron.tronGridUrl });
    this.tronGrid = new TronGrid(this.tronWeb);
    this.committee = ForceBridgeCore.config.tron.committee;
  }

  private async getTrxAndTrc10LockEvents(min_timestamp: number): Promise<TronLockEvent[]> {
    const txs = await this.tronGrid.account.getTransactions(this.committee.address, {
      only_to: true,
      only_confirmed: true,
      min_timestamp: min_timestamp,
    });

    let lockEvents: TronLockEvent[];
    for (let i = 0; i < txs.data.length; i++) {
      const asset_data = txs.data[i].raw_data.contract[0].parameter.value;
      lockEvents[i] = {
        tx_hash: txs.data[i].txID,
        sender: this.tronWeb.address.fromHex(asset_data.owner_address),
        asset: asset_data.asset_name ? asset_data.asset_name : 'trx',
        amount: asset_data.amount,
        memo: this.tronWeb.toUtf8(txs.data[i].raw_data.data),
        timestamp: txs.data[i].block_timestamp,
      };
    }
    return lockEvents;
  }

  private async getTrc20TxsLockEvents(min_timestamp: number): Promise<TronLockEvent[]> {
    const txs = await this.tronGrid.account.getTrc20Transactions(this.committee.address, {
      only_confirmed: true,
      only_to: true,
      min_timestamp: min_timestamp,
    });

    let lockEvents: TronLockEvent[];
    for (let i = 0; i < txs.data.length; i++) {
      const tx = await this.tronWeb.trx.getTransaction(txs.data[i].transaction_id);
      lockEvents[i] = {
        tx_hash: txs.data[i].transaction_id,
        sender: txs.data[i].from,
        asset: this.tronWeb.address.fromHex(txs.data[i].token_info).address,
        amount: txs.data[i].value,
        memo: this.tronWeb.toUtf8(tx.raw_data.data),
        timestamp: txs.data[i].block_timestamp,
      };
    }
    return lockEvents;
  }

  // memo style should be "ckb_recipient,sudt_extra_data"
  private analyzeMemo(memo: string) {
    const splitted = memo.split(',', 2);
    const ckbRecipient = splitted[0];
    const sudtExtraData = splitted[1];

    //todo, check ckb_address valid
    return { ckbRecipient, sudtExtraData };
  }

  private async getMinTimestamp(latestLockRecords: TronLock[]) {
    const configMinTimestamp = ForceBridgeCore.config.tron.startTimestamp;
    if (latestLockRecords.length == 0) {
      return configMinTimestamp;
    } else {
      return latestLockRecords[0].timestamp;
    }
  }

  private transferEventToCkbMint(event: TronLockEvent) {
    const { ckbRecipient, sudtExtraData } = this.analyzeMemo(event.memo);
    return {
      id: event.tx_hash.concat(event.index.toString()),
      chain: ChainType.TRON,
      asset: event.asset,
      amount: event.amount,
      recipientLockscript: ckbRecipient,
      sudtExtraData: sudtExtraData,
    };
  }

  private transferEventToTronLock(event: TronLockEvent) {
    const data = {
      tronLockTxHash: event.tx_hash,
      tronLockIndex: 0,
      tronSender: event.sender,
      asset: event.asset,
      assetType: event.asset,
      amount: event.amount,
      memo: event.memo,
      timestamp: event.timestamp,
      committee: this.committee.address,
    };

    return new TronLock().from(data);
  }

  // listen Tron chain and handle the new lock events
  async watchLockEvents(): Promise<void> {
    const latestLockRecords = await this.db.getLatestLockRecords();
    const minTimestamp = await this.getMinTimestamp(latestLockRecords);

    while (true) {
      logger.debug('get new lock events and save to db');

      let ckbMintRecords: ICkbMint[];
      let tronLockRecords: TronLock[];
      const trxAndTrc10Events = await this.getTrxAndTrc10LockEvents(minTimestamp);
      const trc20LockEvents = await this.getTrc20TxsLockEvents(minTimestamp);
      const totalLockEvents = trxAndTrc10Events.concat(trc20LockEvents);

      for (let i = 0; i < totalLockEvents.length; i++) {
        if (totalLockEvents[i].timestamp == minTimestamp) {
          continue;
        } else {
          const ckbMint = this.transferEventToCkbMint(totalLockEvents[i]);
          ckbMintRecords.push(ckbMint);
          const tronLock = this.transferEventToTronLock(totalLockEvents[i]);
          tronLockRecords.push(tronLock);
        }
      }
      await this.db.createCkbMint(ckbMintRecords);
      await this.db.createTronLock(tronLockRecords);

      await asyncSleep(3000);
    }
  }

  private async multiSignTransferTrx(unlockRecord: TronUnlock) {
    const from = this.committee.address;
    const to = unlockRecord.tronRecipientAddress;
    const amount = unlockRecord.amount;
    const memo = unlockRecord.memo;
    const unsigned_tx = await this.tronWeb.transactionBuilder.sendTrx(to, amount, from, {
      permissionId: this.committee.permissionId,
    });

    const unsignedWithMemoTx = await this.tronWeb.transactionBuilder.addUpdateData(unsigned_tx, memo, 'utf8');

    let signed_tx = unsignedWithMemoTx;
    for (let i = 0; i < this.committee.keys.length; i++) {
      signed_tx = await this.tronWeb.trx.multiSign(signed_tx, this.committee.keys[i]);
    }

    const broad_tx = await this.tronWeb.trx.broadcast(signed_tx);
    return broad_tx.txid;
  }

  private async multiSignTransferTrc10(unlockRecord: TronUnlock) {
    const from = this.committee.address;
    const to = unlockRecord.tronRecipientAddress;
    const amount = unlockRecord.amount;
    const tokenID = unlockRecord.asset;
    const memo = unlockRecord.memo;
    const unsigned_tx = await this.tronWeb.transactionBuilder.sendToken(to, amount, tokenID, from, {
      permissionId: this.committee.permissionId,
    });

    const unsignedWithMemoTx = await this.tronWeb.transactionBuilder.addUpdateData(unsigned_tx, memo, 'utf8');

    let signed_tx = unsignedWithMemoTx;
    for (let i = 0; i < this.committee.keys.length; i++) {
      signed_tx = await this.tronWeb.trx.multiSign(signed_tx, this.committee.keys[i]);
    }

    const broad_tx = await this.tronWeb.trx.broadcast(signed_tx);
    return broad_tx.txid;
  }

  private async multiSignTransferTrc20(unlockRecord: TronUnlock) {
    const from = this.committee.address;
    const to = unlockRecord.tronRecipientAddress;
    const amount = unlockRecord.amount;
    const trc20ContractAddress = unlockRecord.asset;
    const memo = unlockRecord.memo;

    const options = {
      permissionId: this.committee.permissionId,
      feeLimit: 1000000,
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
    for (let i = 0; i < this.committee.keys.length; i++) {
      signed_tx = await this.tronWeb.trx.multiSign(signed_tx, this.committee.keys[i]);
    }
    const broad_tx = await this.tronWeb.trx.broadcast(signed_tx);
    return broad_tx.txid;
  }

  // watch the eth_unlock table and handle the new unlock events
  // send tx according to the data
  async watchUnlockEvents(): Promise<void> {
    while (true) {
      logger.debug('flush pending tx to confirm');
      const pendingRecords = await this.db.getTronUnlockRecords('pending');
      for (let i = 0; i < pendingRecords.length; i++) {
        // check tx is confirmed
        pendingRecords[i].status = 'confirmed';
      }
      await this.db.saveTronUnlock(pendingRecords);

      logger.debug('get new unlock events and send tx');
      const unlockRecords = await this.db.getTronUnlockRecords('init');
      for (let i = 0; i < unlockRecords.length; i++) {
        let txid: string;
        switch (unlockRecords[i].assetType) {
          case 'trx':
            txid = await this.multiSignTransferTrx(unlockRecords[i]);
          case 'trc10':
            txid = await this.multiSignTransferTrc10(unlockRecords[i]);
          case 'trc20':
            txid = await this.multiSignTransferTrc20(unlockRecords[i]);
        }
        unlockRecords[i].tronUnlockTxHash = txid;
        unlockRecords[i].tronUnlockTxIndex = 0;
        unlockRecords[i].status = 'pending';
      }
      await this.db.saveTronUnlock(unlockRecords);

      await asyncSleep(3000);
    }
  }

  start() {
    this.watchLockEvents();
    this.watchUnlockEvents();
    logger.info('eth handler started  🚀');
  }
}
