// import { EthDb } from '@force-bridge/db';
// import { ForceBridgeCore } from '@force-bridge/core';
// import { BtcUnlock } from '@force-bridge/db/entity/BtcUnlock';
// import { BtcLock } from '@force-bridge/db/entity/BtcLock';

// import { logger } from '@force-bridge/utils/logger';
// import { ChainType } from '@force-bridge/ckb/model/asset';
// import 'module-alias/register';
import { RPCClient } from 'rpc-bitcoin';
const BigNumber = require('bignumber.js');
import bitcore from 'bitcore-lib';
import { BtcLockData, BtcUnlockResult } from '@force-bridge/xchain/btc/type';
import { BtcUnlock } from '@force-bridge/db/entity/BtcUnlock';
/// import { asyncSleep } from '@force-bridge/utils';

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
    console.log('multiAddress is : ', this.multiAddress);
    const url = 'http://127.0.0.1';
    const user = 'test';
    const pass = 'test';
    const port = 18443;
    const timeout = 10000;
    this.rpcClient = new RPCClient({ url, port, timeout, user, pass });
  }

  async watchLockEvents(startHeight = 1, endHeight, handleLockEvetAsyncFunc) {
    for (let blockHeight = startHeight; blockHeight <= endHeight; blockHeight++) {
      const blockhash = await this.rpcClient.getblockhash({ height: blockHeight });
      const block = await this.rpcClient.getblock({ blockhash, verbosity: 2 });
      if (block.tx.length === 1) {
        continue;
      }
      let waitVerifyTxs = block.tx.slice(1);
      for (let txIndex = 0; txIndex < waitVerifyTxs.length; txIndex++) {
        let txVouts = waitVerifyTxs[txIndex].vout;
        if (isLockTx(txVouts, this.multiAddress)) {
          console.log('tda: ', new BigNumber(txVouts[0].value));
          const data: BtcLockData = {
            blockHeight: block.height,
            blockHash: block.hash,
            txId: waitVerifyTxs[txIndex].txid,
            txHash: waitVerifyTxs[txIndex].hash,
            rawTx: waitVerifyTxs[txIndex].hex,
            txIndex: txIndex,
            amount: new BigNumber(txVouts[0].value).multipliedBy(Math.pow(10, 8)).toString(), //*(Math.pow(10,8))),
            data: new Buffer(txVouts[1].scriptPubKey.hex.substring(4), 'hex').toString(),
          };
          await handleLockEvetAsyncFunc(data);
        }
      }
    }
  }

  async sendUnlockTxs(records: BtcUnlock[]): Promise<BtcUnlockResult> {
    const liveUtxos = await this.rpcClient.scantxoutset({
      action: 'start',
      scanobjects: ['addr(' + this.multiAddress + ')'],
    });
    let VinNeedAmount = BigNumber(0);
    let transaction = new bitcore.Transaction();
    const params = records.map((r) => {
      VinNeedAmount = VinNeedAmount.plus(BigNumber(r.amount));
      transaction = transaction.to(r.recipientAddress, BigNumber(r.amount).toString());
    });

    const utxos = getVins(liveUtxos.unspents, VinNeedAmount);
    if (!!(utxos && utxos.length)) {
      console.error(`the unspend utxo is no for unlock. need : ${VinNeedAmount}. actual uxtos : ${liveUtxos}.`);
    }
    transaction = transaction
      .from(utxos, this.multiPubkeys, 2)
      // .to(receiveBtcAddr, 5000)
      .addData('unlock')
      .change(this.multiAddress)
      .sign([this.multiPrivKeys[0], this.multiPrivKeys[3]]);

    const startHeight = await this.getBtcHeight();
    const txHash = await this.rpcClient.sendrawtransaction({ hexstring: transaction.serialize() });
    console.debug('txHash', txHash);
    return { startBlockHeight: startHeight, txHash };
    // await sleep(6000);
    // await this.isTxInBlockAfterConfirm(this.rpcClient, startHeight[0].height, txHash, 3);
  }
  async isTxInBlockAfterSubmit(client: RPCClient, startHeight, endHeight, txHash): Promise<boolean> {
    for (let blockHeight = startHeight; blockHeight <= endHeight; blockHeight++) {
      const blockhash = await client.getblockhash({ height: blockHeight });
      const block = await client.getblock({ blockhash, verbosity: 2 });
      if (block.tx.length === 1) {
        continue;
      }
      let waitVerifyTxs = block.tx.slice(1);
      for (let txIndex = 0; txIndex < waitVerifyTxs.length; txIndex++) {
        if (waitVerifyTxs[txIndex].hash === txHash) {
          console.log(
            'tx ',
            txHash,
            'is in block ',
            blockHeight,
            blockhash,
            JSON.stringify(waitVerifyTxs[txIndex], null, 2),
          );
          return true;
        }
      }
    }
    console.log('tx,', txHash, ' not found in block');
    return false;
  }

  async getBtcHeight(): Promise<number> {
    const height = await this.rpcClient.getchaintips();
    return height[0].height;
  }
}

function getVins(liveUtxos, unlockAmount) {
  let utxoAmount = BigNumber(0);
  let vins = [];
  for (let i = 0; utxoAmount.lt(unlockAmount); i++) {
    utxoAmount = utxoAmount.plus(BigNumber(liveUtxos[i].amount).multipliedBy(Math.pow(10, 8)));
    vins.push(liveUtxos[i]);
  }
  console.log('vin utxo amount ', utxoAmount);
  if (utxoAmount.lt(unlockAmount)) {
    return [];
  }
  return vins;
}

function isLockTx(txVouts, multisignAddr: string): boolean {
  if (!(txVouts && txVouts.length && txVouts.length >= 2)) {
    return false;
  }
  const firstVoutScriptAddrList = txVouts[0].scriptPubKey.addresses;
  const secondVoutScriptPubKeyHex: string = txVouts[1].scriptPubKey.hex;
  console.log('firstVoutScriptAddrList: ', firstVoutScriptAddrList);

  if (!(firstVoutScriptAddrList && firstVoutScriptAddrList.length && firstVoutScriptAddrList.length === 1)) {
    return false;
  }
  const receiveAddr = new Buffer(secondVoutScriptPubKeyHex.substring(4), 'hex').toString();

  if (receiveAddr.startsWith('ck')) {
    console.log('receive addr', receiveAddr);
  }
  return (
    firstVoutScriptAddrList[0] === multisignAddr &&
    secondVoutScriptPubKeyHex.startsWith('6a08') &&
    receiveAddr.startsWith('ck')
  );
}

async function LockEventHandler(data) {
  console.log('log lock record ', data);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  let test = new BTCChain();
  // let now = await  test.getBtcHeight();
  // console.log("height ", now)
  await test.watchLockEvents(7000, 8056, LockEventHandler);
  // await test.sendUnlockTxs('mtoKs9V381UAhUia3d7Vb9GNak8Qvmcsme');
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
