import { logger } from '@force-bridge/utils/logger';
import { BtcLockData, BtcUnlockResult } from '@force-bridge/xchain/btc/type';
import { BtcUnlock } from '@force-bridge/db/entity/BtcUnlock';
import { RPCClient } from 'rpc-bitcoin';
import bitcore from 'bitcore-lib';
const BigNumber = require('bignumber.js');

const BtcLockEventMark = 'ck';
const BtcUnlockEventMark = 'unlock';
const CkbBurnSplitMark = 'tx';

export class BTCChain {
  protected readonly rpcClient: RPCClient;
  protected readonly multiAddress: string;
  protected readonly multiPubkeys;
  protected readonly multiPrivKeys;

  constructor() {
    // const config = ForceBridgeCore.config.eth;
    // const url = config.rpcUrl;
    const privKeys = [
      '0xc4ad657963930fbff2e9de3404b30a4e21432c89952ed430b56bf802945ed370',
      '0xc4ad657963930fbff2e9de3404b30a4e21432c89952ed430b56bf802945ed371',
      '0xc4ad657963930fbff2e9de3404b30a4e21432c89952ed430b56bf802945ed372',
      '0xc4ad657963930fbff2e9de3404b30a4e21432c89952ed430b56bf802945ed373',
    ];
    this.multiPrivKeys = privKeys.map((pk) => new bitcore.PrivateKey(pk.slice(2)));
    this.multiPubkeys = this.multiPrivKeys.map((pk) => pk.toPublicKey());
    this.multiAddress = bitcore.Address.createMultisig(this.multiPubkeys, 2, 'testnet').toString();
    logger.debug('multiAddress is : ', this.multiAddress);
    const url = 'http://127.0.0.1';
    const user = 'test';
    const pass = 'test';
    const port = 18443;
    const timeout = 10000;
    this.rpcClient = new RPCClient({ url, port, timeout, user, pass });
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
        const ckbBurnTxHashes = await this.getUnockTxData(waitVerifyTxs[txIndex].vin, txVouts);
        logger.debug('verify block :', blockHeight, 'tx ', waitVerifyTxs[txIndex].hash);
        if (ckbBurnTxHashes && ckbBurnTxHashes.length) {
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

  async sendLockTxs(fromAdress: string, amount: number, fromPrivKey, recipient: string) {
    if (!recipient.startsWith(BtcLockEventMark)) {
      throw new Error(`${recipient} must be available ckb address`);
    }
    logger.debug('params ', fromAdress, amount, fromPrivKey.toString());
    const liveUtxos = await this.rpcClient.scantxoutset({
      action: 'start',
      scanobjects: ['addr(' + fromAdress + ')'],
    });
    logger.debug('liveUtxos', liveUtxos);
    const utxos = getVins(liveUtxos.unspents, BigNumber(amount));
    if (!(utxos && utxos.length)) {
      throw new Error(
        'the unspend utxo is no for unlock. need :' + amount + '. actual uxtos : ' + JSON.stringify(liveUtxos, null, 2),
      );
    }
    const lockTx = new bitcore.Transaction()
      .from(utxos)
      .to(this.multiAddress, amount)
      .addData(recipient)
      .change(fromAdress)
      .sign(fromPrivKey);
    const lockTxHash = await this.rpcClient.sendrawtransaction({ hexstring: lockTx.serialize() });
    logger.debug('lockTxHash', lockTxHash);
  }

  async sendUnlockTxs(records: BtcUnlock[]): Promise<BtcUnlockResult> {
    logger.debug('records:', records);
    const liveUtxos = await this.rpcClient.scantxoutset({
      action: 'start',
      scanobjects: ['addr(' + this.multiAddress + ')'],
    });
    logger.debug('liveUtxos:', liveUtxos);
    let VinNeedAmount = BigNumber(0);
    let unlockVout = [];
    let unlockData = BtcUnlockEventMark;
    records.map((r) => {
      unlockData = unlockData + CkbBurnSplitMark + r.ckbTxHash;
      VinNeedAmount = VinNeedAmount.plus(BigNumber(r.amount));
      unlockVout.push({ address: r.recipientAddress, satoshis: BigNumber(r.amount).toNumber() });
    });
    const utxos = getVins(liveUtxos.unspents, VinNeedAmount);
    logger.debug('VinNeedAmount ', VinNeedAmount, 'utxo ', utxos);

    if (!(utxos && utxos.length)) {
      logger.error(`the unspend utxo is no for unlock. need : ${VinNeedAmount}. actual uxtos : .`, liveUtxos);
    }
    const transaction = new bitcore.Transaction()
      .from(utxos, this.multiPubkeys, 2)
      .to(unlockVout)
      .fee(1500)
      .addData(unlockData)
      .change(this.multiAddress)
      .sign([this.multiPrivKeys[0], this.multiPrivKeys[3]]);
    logger.debug('tx', JSON.stringify(transaction, null, 2));

    const startHeight = await this.getBtcHeight();
    const txHash = await this.rpcClient.sendrawtransaction({ hexstring: transaction.serialize() });
    logger.debug('txHash', txHash);
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
    logger.debug('firstVoutScriptAddrList: ', firstVoutScriptAddrList);

    if (!(firstVoutScriptAddrList && firstVoutScriptAddrList.length && firstVoutScriptAddrList.length === 1)) {
      return false;
    }
    const receiveAddr = new Buffer(secondVoutScriptPubKeyHex.substring(4), 'hex').toString();

    if (receiveAddr.startsWith(BtcLockEventMark)) {
      logger.debug('receive addr', receiveAddr);
    }
    return (
      firstVoutScriptAddrList[0] === this.multiAddress &&
      secondVoutScriptPubKeyHex.startsWith('6a') &&
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
    if (!(txVins && txVins.length)) {
      return false;
    }
    // logger.debug("txVins :", txVins);
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
