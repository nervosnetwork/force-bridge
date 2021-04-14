import { logger } from '@force-bridge/utils/logger';
import {
  BtcLockData,
  BtcUnlockResult,
  IBalance,
  IBlock,
  ITx,
  IUnspents,
  IVin,
  IVout,
  MainnetFee,
} from '@force-bridge/xchain/btc/type';
import { BtcUnlock } from '@force-bridge/db/entity/BtcUnlock';
import { RPCClient } from 'rpc-bitcoin';
import bitcore from 'bitcore-lib';
import { ForceBridgeCore } from '@force-bridge/core';
import axios from 'axios';

const Unit = bitcore.Unit;
const BtcLockEventMark = 'ck';
const BtcOPReturnCode = '6a';
const BtcDataIndex = 4;
const CkbTxHashLen = 64;

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
    const multiAddress = bitcore.Address.createMultisig(this.multiPubkeys, 2, 'testnet').toString();
    logger.debug(
      `the multi sign address by calc privkeys is : ${multiAddress}. the provider lock address is ${config.lockAddress}`,
    );
    if (multiAddress !== config.lockAddress) {
      throw new Error(
        `the multi sign address by calc privkeys is : ${multiAddress}. which different ${config.lockAddress} in conf.`,
      );
    }
    this.multiAddress = multiAddress;
    this.rpcClient = new RPCClient(clientParams);
  }

  async watchBtcTxEvents(startHeight = 1, endHeight, handleLockAsyncFunc, handleUnlockAsyncFunc) {
    for (let blockHeight = startHeight; blockHeight <= endHeight; blockHeight++) {
      const blockhash = await this.rpcClient.getblockhash({ height: blockHeight });
      const block: IBlock = await this.rpcClient.getblock({ blockhash, verbosity: 2 });
      if (block.tx.length === 1) {
        continue;
      }
      let waitVerifyTxs = block.tx.slice(1);
      for (let txIndex = 0; txIndex < waitVerifyTxs.length; txIndex++) {
        const txVouts = waitVerifyTxs[txIndex].vout;
        const ckbBurnTxHashes: string[] = await this.getUnlockTxData(waitVerifyTxs[txIndex].vin, txVouts);
        if (ckbBurnTxHashes.length != 0) {
          logger.debug(
            `verify for unlock event. block ${blockHeight} tx ${waitVerifyTxs[txIndex].hash}. find ckb burn hashes:  ${ckbBurnTxHashes}`,
          );
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
            amount: Unit.fromBTC(txVouts[0].value).toSatoshis(),
            data: Buffer.from(txVouts[1].scriptPubKey.hex.substring(4), 'hex').toString(),
          };
          logger.debug(`verify for lock event. btc lock data: ${JSON.stringify(data, null, 2)}`);
          await handleLockAsyncFunc(data);
        }
      }
    }
  }

  async sendLockTxs(
    fromAdress: string,
    amount: number,
    fromPrivKey: bitcore.PrivateKey,
    memo: string,
    feeRate: number,
  ): Promise<string> {
    logger.debug(
      `lock tx params: fromAdress ${fromAdress}. amount ${amount}. fromPrivKey ${fromPrivKey.toString()}. memo ${memo}`,
    );
    if (!memo.startsWith(BtcLockEventMark)) {
      throw new Error(`${memo} must start with available ckb address`);
    }
    const liveUtxos: IBalance = await this.rpcClient.scantxoutset({
      action: 'start',
      scanobjects: [`addr(${fromAdress})`],
    });

    logger.debug(`collect live utxos for lock. total_amount is : ${liveUtxos.total_amount} btc`);
    const utxos = getVins(liveUtxos, BigInt(amount));
    if (utxos.length === 0) {
      throw new Error(
        `the unspend utxo is not enough for lock. need : ${amount}. actual uxtos :  ${JSON.stringify(
          liveUtxos,
          null,
          2,
        )}`,
      );
    }
    const transactionWithoutFee = new bitcore.Transaction()
      .from(utxos)
      .to(this.multiAddress, amount)
      .addData(memo)
      .change(fromAdress)
      .sign(fromPrivKey);
    const txSize = transactionWithoutFee.serialize().length / 2;
    const lockTx = new bitcore.Transaction()
      .from(utxos)
      .to(this.multiAddress, amount)
      .fee(feeRate * txSize)
      .addData(memo)
      .change(fromAdress)
      .sign(fromPrivKey);
    const lockTxHash = await this.rpcClient.sendrawtransaction({ hexstring: lockTx.serialize() });
    logger.debug(
      `user ${fromAdress} lock ${amount} satoshis; the lock tx hash is ${lockTxHash}. the tx fee rate is ${feeRate}. the tx fee is ${
        feeRate * txSize
      }`,
    );
    return lockTxHash;
  }

  async sendUnlockTxs(records: BtcUnlock[]): Promise<BtcUnlockResult> {
    if (records.length === 0) {
      throw new Error('the unlock records should not be null');
    }
    if (records.length > 2) {
      throw new Error('the limit of op_return output size is 80 bytes which can contain 2 ckb tx hash (32*2 bytes)');
    }
    logger.debug('database records which need exec unlock:', records);
    const liveUtxos: IBalance = await this.rpcClient.scantxoutset({
      action: 'start',
      scanobjects: [`addr(${this.multiAddress})`],
    });
    logger.debug(`collect live utxos for unlock: ${JSON.stringify(liveUtxos, null, 2)}`);
    let VinNeedAmount = BigInt(0);
    let unlockVout = [];
    let unlockData = '';
    records.map((r) => {
      let tx_hash = r.ckbTxHash;
      if (tx_hash.startsWith('0x')) {
        tx_hash = tx_hash.substring(2);
      }
      unlockData = unlockData + tx_hash;
      VinNeedAmount = VinNeedAmount + BigInt(r.amount);
      unlockVout.push({ address: r.recipientAddress, satoshis: Number(r.amount) });
    });
    let BurnTxHashes = Buffer.from(unlockData, 'hex');

    const utxos = getVins(liveUtxos, VinNeedAmount);
    if (utxos.length === 0) {
      throw new Error(
        `the unspend utxo is no for unlock. need : ${VinNeedAmount}. actual uxtos : ${JSON.stringify(
          liveUtxos,
          null,
          2,
        )}`,
      );
    }

    const transactionWithoutFee = new bitcore.Transaction()
      .from(utxos, this.multiPubkeys, 2)
      .to(unlockVout)
      .addData(BurnTxHashes)
      .change(this.multiAddress)
      .sign([this.multiPrivKeys[0], this.multiPrivKeys[3]]);
    const txSize = transactionWithoutFee.serialize().length / 2;
    const feeRate = await getBtcMainnetFee();
    const transaction = new bitcore.Transaction()
      .from(utxos, this.multiPubkeys, 2)
      .to(unlockVout)
      .fee(feeRate.hourFee * txSize)
      .addData(BurnTxHashes)
      .change(this.multiAddress)
      .sign([this.multiPrivKeys[0], this.multiPrivKeys[3]]);

    logger.debug(
      `generate unlock tx ${JSON.stringify(transaction, null, 2)}. the tx fee rate is ${JSON.stringify(
        feeRate,
        null,
        2,
      )}. the tx size is  ${txSize}. all the tx fee is ${feeRate.hourFee * txSize}`,
    );

    const startHeight = await this.getBtcHeight();
    const txHash = await this.rpcClient.sendrawtransaction({ hexstring: transaction.serialize() });
    logger.debug(`the unlock tx hash is ${txHash} which should in chain after block ${startHeight} `);
    return { startBlockHeight: startHeight, txHash };
  }

  async getBtcHeight(): Promise<number> {
    const height = await this.rpcClient.getchaintips();
    return height[0].height;
  }

  isLockTx(txVouts: IVout[]): boolean {
    if (txVouts.length < 2) {
      return false;
    }
    const firstVoutScriptAddrList = txVouts[0].scriptPubKey.addresses;
    const secondVoutScriptPubKeyHex: string = txVouts[1].scriptPubKey.hex;

    if (firstVoutScriptAddrList.length != 1) {
      return false;
    }
    const receiveAddr = Buffer.from(secondVoutScriptPubKeyHex.substring(BtcDataIndex), 'hex').toString();

    if (receiveAddr.startsWith(BtcLockEventMark)) {
      logger.debug(
        `first vout script addr List ${firstVoutScriptAddrList}.should contain lock address ${this.multiAddress}. receive addr ${receiveAddr}`,
      );
    }
    return (
      firstVoutScriptAddrList[0] === this.multiAddress &&
      secondVoutScriptPubKeyHex.startsWith(BtcOPReturnCode) &&
      receiveAddr.startsWith(BtcLockEventMark)
    );
  }

  async getUnlockTxData(txVins: IVin[], txVouts: IVout[]): Promise<string[]> {
    if (!(await this.isAddressInInput(txVins, this.multiAddress)) || txVouts.length < 2) {
      return [];
    }
    let waitVerifyTxVouts = txVouts.slice(1);
    for (let i = 0; i < waitVerifyTxVouts.length; i++) {
      const voutPubkeyHex = waitVerifyTxVouts[i].scriptPubKey.hex;
      if (voutPubkeyHex.startsWith(BtcOPReturnCode)) {
        logger.debug(`verify op return output data : ${voutPubkeyHex}`);
        return splitTxhash(voutPubkeyHex.substring(BtcDataIndex));
      }
    }
    return [];
  }

  async isAddressInInput(txVins: IVin[], address: string): Promise<boolean> {
    if (txVins.length === 0) {
      return false;
    }
    let inputRawTx: ITx = await this.rpcClient.getrawtransaction({ txid: txVins[0].txid, verbose: true });
    let txSenders = inputRawTx.vout[txVins[0].vout].scriptPubKey.addresses;
    for (let i = 0; i < txSenders.length; i++) {
      if (address === txSenders[i]) {
        return true;
      }
    }
    return false;
  }
}

function getVins(balance: IBalance, unlockAmount: BigInt): IUnspents[] {
  if (BigInt(Unit.fromBTC(balance.total_amount).toSatoshis()) < unlockAmount || balance.unspents.length === 0) {
    return [];
  }
  let utxoAmount = 0n;
  let vins = [];
  for (let i = 0; utxoAmount < unlockAmount; i++) {
    utxoAmount = utxoAmount + BigInt(Unit.fromBTC(balance.unspents[i].amount).toSatoshis());
    vins.push(balance.unspents[i]);
  }
  return vins;
}

function splitTxhash(burnHashesStr: string): string[] {
  if (burnHashesStr.length % CkbTxHashLen != 0) {
    return [];
  }
  let index = 0;
  let burnHashes = [];
  while (index < burnHashesStr.length) {
    burnHashes.push(burnHashesStr.slice(index, (index += CkbTxHashLen)));
  }
  return burnHashes;
}

//Todo: the url is for maintain. not fount testnet fee info yet.
export async function getBtcMainnetFee(): Promise<MainnetFee> {
  try {
    const res = await axios.get('https://bitcoinfees.earn.com/api/v1/fees/recommended');
    return res.data;
  } catch (err) {
    console.error('failed get btc mainnet recommended fee. by error : ', err.response.data);
  }
}
