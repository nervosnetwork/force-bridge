import { parsePrivateKey } from '../packages/utils';
import { logger } from '../packages/utils/logger';
import CKB from '@nervosnetwork/ckb-sdk-core';
import { Account } from '../packages/ckb/model/accounts';
import { CkbTxGenerator } from '../packages/ckb/tx-helper/generator';
import PWCore, { Amount } from '@lay2/pw-core';
import { IndexerCollector } from '../packages/ckb/tx-helper/collector';
import { CkbIndexer } from '../packages/ckb/tx-helper/indexer';
import { fromHexString, stringToUint8Array, toHexString, uint8ArrayToString } from '../packages/utils';
import { BigNumber, ethers } from 'ethers';
import { ForceBridgeCore } from '@force-bridge/core';
import { Reader } from 'ckb-js-toolkit';
import { RPC } from '@ckb-lumos/rpc';

// const CKB_URL = process.env.CKB_URL || 'http://127.0.0.1:8114';
// const CKB_INDEXER_URL = process.env.CKB_INDEXER_URL || 'http://127.0.0.1:8116';
// const ckb = new CKB(CKB_URL);
// const PRI_KEY = process.env.PRI_KEY || '0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe';

async function main() {
  console.log('start');
  const path = 'privkeys/eth';
  const pk = await parsePrivateKey(path);
  console.log(`pk: ${pk}`);
  // const account = new Account(PRI_KEY);
  // logger.debug('address', account.address);
  // const pw = await new PWCore(CKB_URL).init();
  // const indexer = new CkbIndexer(CKB_INDEXER_URL, CKB_URL);
  // const ckbRpc = new RPC('http://127.0.0.1:8114');
  // // const tx = await ckbRpc.get_transaction('0x3e41080968db4f2b4db5d546ffb886a2e46a4444c57b0653563482de84d6da59');
  // const tx = await ckbRpc.get_live_cell({tx_hash: '0x3e41080968db4f2b4db5d546ffb886a2e46a4444c57b0653563482de84d6da59', index: '0x0'}, false);
  // console.dir(tx, {depth: null})
  // const collector = new IndexerCollector(indexer);
  // const generator = new CkbTxGenerator(collector);
  // const bb = BigNumber.from('0.0001');
  const bb = new Amount('1', 0);
  console.log('res:', bb.toBigInt());
  // const bb = Amount.fromUInt128LE('0x0001');
  // // const dd = BigAmount.fromUInt128LE(`0x10270000000000000000000000000000`);
  //
  // const aa = uint8ArrayToString(fromHexString('0x454f53')).slice(1);
  // const params = {
  //   recipient_address: fromHexString('0x10270000000000000000000000000000').buffer,
  //   chain: 1,
  //   asset: fromHexString('0x10270000000000000000000000000000').buffer,
  //   amount: fromHexString('0x10270000000000000000000000000000').buffer,
  //   bridge_lock_code_hash: fromHexString('0x1027000000000000000000000000000010270000000000000000000000000000').buffer,
  //   owner_lock_hash: fromHexString('0x1027000000000000000000000000000010270000000000000000000000000000').buffer,
  //   fee: fromHexString('0x10270000000000000000000000000000').buffer,
  // };
  //
  // const recipientCellData = SerializeRecipientCellData(params);
  // logger.debug('seri data: ', recipientCellData);
  // logger.debug('seri data: ', toHexString(new Uint8Array(recipientCellData)));
  //
  // const cellData = new RecipientCellData(
  //   fromHexString(
  //     '0xb1000000200000003800000039000000510000007100000091000000a1000000140000001000000000000000000000000000000000000001011400000000000000000000000000000000000000000000000e95396c13c9f0dfb48fedfe0dd670eaa228fb8fb6f5a82b8b8dfe89c8c1bb379bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce80100000000000000000000000000000000000000000000000000000000000000',
  //   ).buffer,
  // );
  // logger.debug('amount: ', toHexString(new Uint8Array(cellData.getAmount().raw())));
  // logger.debug('recipient address: ', toHexString(new Uint8Array(cellData.getRecipientAddress().raw())));

  // logger.debug('res', bb.toString(), dd);
}

main();

// export function stringToUint8Array(str): Uint8Array {
//   const arr = [];
//   for (let i = 0, j = str.length; i < j; ++i) {
//     arr.push(str.charCodeAt(i));
//   }
//   const tmpUint8Array = new Uint8Array(arr);
//   return tmpUint8Array;
// }
//
// export const toHexString = (bytes) => bytes.reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '');
