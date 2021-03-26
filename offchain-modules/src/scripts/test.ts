import { logger } from '../packages/utils/logger';
import CKB from '@nervosnetwork/ckb-sdk-core';
import { Account } from '../packages/ckb/model/accounts';
import { CkbTxGenerator } from '../packages/ckb/tx-helper/generator';
import PWCore, { Amount } from '@lay2/pw-core';
import { IndexerCollector } from '../packages/ckb/tx-helper/collector';
import { CkbIndexer } from '../packages/ckb/tx-helper/indexer';
import { fromHexString, stringToUint8Array, toHexString, uint8ArrayToString } from '../packages/utils';
import { BigNumber } from 'ethers';

const CKB_URL = process.env.CKB_URL || 'http://127.0.0.1:8114';
const CKB_INDEXER_URL = process.env.CKB_INDEXER_URL || 'http://127.0.0.1:8116';
const ckb = new CKB(CKB_URL);
const PRI_KEY = process.env.PRI_KEY || '0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe';

async function main() {
  logger.debug('start ckb test');
  const account = new Account(PRI_KEY);
  logger.debug('address', account.address);
  // const pw = await new PWCore(CKB_URL).init();
  // const indexer = new CkbIndexer(CKB_INDEXER_URL, CKB_URL);
  // const collector = new IndexerCollector(indexer);
  // const generator = new CkbTxGenerator(collector);
  // const bb = BigNumber.from('0.0001');
  // const bb = new Amount('0.0001');
  const bb = Amount.fromUInt128LE('0x0001');
  const cc = Amount.fromUInt128LE('0x10270000000000000000000000000000');
  // const dd = BigAmount.fromUInt128LE(`0x10270000000000000000000000000000`);

  const aa = uint8ArrayToString(fromHexString('0x454f53')).slice(1);

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
