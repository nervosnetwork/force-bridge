import { logger } from '@force-bridge/utils/logger';
import { BtcLockData, BtcUnlockResult } from '@force-bridge/xchain/btc/type';
import { BtcUnlock } from '@force-bridge/db/entity/BtcUnlock';
import { RPCClient } from 'rpc-bitcoin';
import bitcore from 'bitcore-lib';
import { ForceBridgeCore } from '@force-bridge/core';
import { isEmptyArray } from '@force-bridge/utils';
const BigNumber = require('bignumber.js');

const BtcLockEventMark = 'ck';
const BtcUnlockEventMark = 'unlock';
const CkbBurnSplitMark = 'tx';
const BtcOPReturnCode = '6a';

export class BTCChain {
  protected readonly rpcClient: RPCClient;
  protected readonly multiAddress: string;
  protected readonly multiPubkeys;
  protected readonly multiPrivKeys;

  constructor() {
    const config = ForceBridgeCore.config.btc;
    const clientParams = config.clientParams;
    const privKeys = config.privateKeys;
    this.multiPrivKeys = privKeys.map((pk) => new bitcore.PrivateKey(pk.slice(2)));
    this.multiPubkeys = this.multiPrivKeys.map((pk) => pk.toPublicKey());
    this.multiAddress = bitcore.Address.createMultisig(this.multiPubkeys, 2, 'testnet').toString();
    logger.debug(`multiAddress is :  ${this.multiAddress}`);
    this.rpcClient = new RPCClient(clientParams);
  }

  async watchBtcTxEvents(startHeight = 1, endHeight, handleLockAsyncFunc, handleUnlockAsyncFunc) {
    for (let blockHeight = startHeight; blockHeight <= endHeight; blockHeight++) {
      const blockhash = await this.rpcClient.getblockhash({ height: blockHeight });
      const block = await this.rpcClient.getblock({ blockhash, verbosity: 2 });
      if (block.tx.length === 1) {
        continue;
      }
      let waitVerifyTxs = block.tx.slice(1);
      for (let txIndex = 0; txIndex < waitVerifyTxs.length; txIndex++) {
        const txVouts = waitVerifyTxs[txIndex].vout;
        logger.debug('verify block :', blockHeight, 'tx ', waitVerifyTxs[txIndex].hash);
        const ckbBurnTxHashes = await this.getUnockTxData(waitVerifyTxs[txIndex].vin, txVouts);
        if (!isEmptyArray(ckbBurnTxHashes)) {
          logger.debug('ckbBurnTxHashes ', ckbBurnTxHashes);
          for (let i = 0; i < ckbBurnTxHashes.length; i++) {
            await handleUnlockAsyncFunc(ckbBurnTxHashes[i]);
          }
        }
        if (this.isLockTx(txVouts)) {
          const data: BtcLockData = {
            blockHeight: block.height,
            blockHash: block.hash,
            txId: waitVerifyTxs[txIndex].txid,
            txHash: waitVerifyTxs[txIndex].hash,
            rawTx: waitVerifyTxs[txIndex].hex,
            txIndex: txIndex,
            amount: new BigNumber(txVouts[0].value).multipliedBy(Math.pow(10, 8)).toString(),
            data: new Buffer(txVouts[1].scriptPubKey.hex.substring(4), 'hex').toString(),
          };
          logger.debug('btc lock data: ', data);
          await handleLockAsyncFunc(data);
        }
      }
    }
  }

  async sendLockTxs(fromAdress: string, amount: number, fromPrivKey, recipient: string): Promise<string> {
    if (!recipient.startsWith(BtcLockEventMark)) {
      throw new Error(`${recipient} must be available ckb address`);
    }
    logger.debug('params ', fromAdress, amount, fromPrivKey.toString());
    const liveUtxos = await this.rpcClient.scantxoutset({
      action: 'start',
      scanobjects: ['addr(' + fromAdress + ')'],
    });
    logger.debug(`collect live utxos for lock: ${JSON.stringify(liveUtxos, null, 2)}`);
    const utxos = getVins(liveUtxos.unspents, BigNumber(amount));
    if (isEmptyArray(utxos)) {
      throw new Error(
        `the unspend utxo is not enough for lock. need : ${amount}. actual uxtos :  ${JSON.stringify(
          liveUtxos,
          null,
          2,
        )}`,
      );
    }
    const lockTx = new bitcore.Transaction()
      .from(utxos)
      .to(this.multiAddress, amount)
      .addData(recipient)
      .change(fromAdress)
      .sign(fromPrivKey);
    const lockTxHash = await this.rpcClient.sendrawtransaction({ hexstring: lockTx.serialize() });
    logger.debug(`user ${fromAdress} lock ${amount} satoshis; the lock tx hash is ${lockTxHash}`);
    return lockTxHash;
  }

  async sendUnlockTxs(records: BtcUnlock[]): Promise<BtcUnlockResult> {
    if (isEmptyArray(records)) {
      throw new Error('the unlock records should not be null');
    }
    logger.debug('database records which need exec unlock:', records);
    const liveUtxos = await this.rpcClient.scantxoutset({
      action: 'start',
      scanobjects: ['addr(' + this.multiAddress + ')'],
    });
    logger.debug(`collect live utxos for unlock: ${JSON.stringify(liveUtxos, null, 2)}`);
    let VinNeedAmount = BigNumber(0);
    let unlockVout = [];
    let unlockData = BtcUnlockEventMark;
    records.map((r) => {
      unlockData = unlockData + CkbBurnSplitMark + r.ckbTxHash;
      VinNeedAmount = VinNeedAmount.plus(BigNumber(r.amount));
      unlockVout.push({ address: r.recipientAddress, satoshis: BigNumber(r.amount).toNumber() });
    });
    const utxos = getVins(liveUtxos.unspents, VinNeedAmount);
    if (isEmptyArray(utxos)) {
      logger.error(`the unspend utxo is no for unlock. need : ${VinNeedAmount}. actual uxtos : .`, liveUtxos);
    }
    const transaction = new bitcore.Transaction()
      .from(utxos, this.multiPubkeys, 2)
      .to(unlockVout)
      .fee(1500)
      .addData(unlockData)
      .change(this.multiAddress)
      .sign([this.multiPrivKeys[0], this.multiPrivKeys[3]]);
    logger.debug(`generate unlock tx ${JSON.stringify(transaction, null, 2)}`);

    const startHeight = await this.getBtcHeight();
    const txHash = await this.rpcClient.sendrawtransaction({ hexstring: transaction.serialize() });
    logger.debug(`the unlock tx hash is ${txHash} which should in chain after block ${startHeight} `);
    return { startBlockHeight: startHeight, txHash };
  }

  async getBtcHeight(): Promise<number> {
    const height = await this.rpcClient.getchaintips();
    return height[0].height;
  }

  isLockTx(txVouts): boolean {
    if (!(txVouts && txVouts.length && txVouts.length >= 2)) {
      return false;
    }
    const firstVoutScriptAddrList = txVouts[0].scriptPubKey.addresses;
    const secondVoutScriptPubKeyHex: string = txVouts[1].scriptPubKey.hex;

    if (!(firstVoutScriptAddrList && firstVoutScriptAddrList.length && firstVoutScriptAddrList.length === 1)) {
      return false;
    }
    const receiveAddr = new Buffer(secondVoutScriptPubKeyHex.substring(4), 'hex').toString();

    if (receiveAddr.startsWith(BtcLockEventMark)) {
      logger.debug(
        'first vout script addr List ',
        firstVoutScriptAddrList,
        `should contain lock address ${this.multiAddress}. receive addr`,
        receiveAddr,
      );
    }
    return (
      firstVoutScriptAddrList[0] === this.multiAddress &&
      secondVoutScriptPubKeyHex.startsWith(BtcOPReturnCode) &&
      receiveAddr.startsWith(BtcLockEventMark)
    );
  }

  async getUnockTxData(txVins, txVouts): Promise<string[]> {
    if (!(await this.isAddressInInput(txVins, this.multiAddress))) {
      return [];
    }
    if (!(txVouts && txVouts.length && txVouts.length >= 2)) {
      return [];
    }
    let waitVerifyTxVouts = txVouts.slice(1);
    for (let i = 0; i < waitVerifyTxVouts.length; i++) {
      const voutPubkeyHex = waitVerifyTxVouts[i].scriptPubKey.hex;
      const receiveAddr = new Buffer(voutPubkeyHex.substring(4), 'hex').toString();
      if (receiveAddr.startsWith(BtcUnlockEventMark)) {
        let ckbTxHashArr = receiveAddr.split(CkbBurnSplitMark);
        if (ckbTxHashArr[0] === BtcUnlockEventMark) {
          ckbTxHashArr.shift();
        }
        return ckbTxHashArr;
      }
    }
    return [];
  }

  async isAddressInInput(txVins, address: string): Promise<boolean> {
    if (isEmptyArray(txVins)) {
      return false;
    }
    let inputRawTx = await this.rpcClient.getrawtransaction({ txid: txVins[0].txid, verbose: true });
    let txSenders = inputRawTx.vout[txVins[0].vout].scriptPubKey.addresses;
    for (let i = 0; i < txSenders.length; i++) {
      if (address === txSenders[i]) {
        return true;
      }
    }
    return false;
  }
}

function getVins(liveUtxos, unlockAmount) {
  if (isEmptyArray(liveUtxos)) {
    return [];
  }
  let utxoAmount = BigNumber(0);
  let vins = [];
  for (let i = 0; utxoAmount.lt(unlockAmount); i++) {
    utxoAmount = utxoAmount.plus(BigNumber(liveUtxos[i].amount).multipliedBy(Math.pow(10, 8)));
    vins.push(liveUtxos[i]);
  }
  if (utxoAmount.lt(unlockAmount)) {
    return [];
  }
  return vins;
}
