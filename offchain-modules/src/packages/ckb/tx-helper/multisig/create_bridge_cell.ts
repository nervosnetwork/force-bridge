import { Indexer, CellCollector } from '@ckb-lumos/indexer';
import { init } from './init_config';
import { TransactionSkeleton, sealTransaction, parseAddress, minimalCellCapacity } from '@ckb-lumos/helpers';
import { Cell, Hash, HashType, HexString, OutPoint, Script } from '@ckb-lumos/base';
import { writeFileSync } from 'fs';
import {
  fromAddress,
  multisigAddress,
  fromPrivateKey,
  multisigScript,
  multisigLockScript,
  serializedMultisigScript,
} from './multisig_helper';
import { common, secp256k1Blake160Multisig } from '@ckb-lumos/common-scripts';
import { key } from '@ckb-lumos/hd';
import { generateTypeIDScript } from './typeid';

import { predefined } from '@ckb-lumos/config-manager';
const { AGGRON4 } = predefined;
import { utils } from '@ckb-lumos/base';
const TransactionManager = require('@ckb-lumos/transaction-manager');
const CKB = require('@nervosnetwork/ckb-sdk-core').default;
const nconf = require('nconf');

const CKB_URL = process.env.CKB_URL || 'http://127.0.0.1:8114';

init();

const acpData = '0x';

console.log('Capacity fromAddress:', fromAddress);

// indexer
// const indexer = new CkbIndexer('http://127.0.0.1:8114', 'http://127.0.0.1:8116');
// const collector = new IndexerCollector(indexer);
const ckb = new CKB(CKB_URL);
const dataDir = './indexer-data';
const indexer = new Indexer('http://127.0.0.1:8114', dataDir);
const keys = [
  '0xd00c06bfd800d27397002dca6fb0993d5ba6399b4238b2f29ee9deb97593d2bc',
  '0x63d86723e08f0f813a36ce6aa123bb2289d90680ae1e99d4de8cdb334553f24d',
];
indexer.startForever();

const transactionManager = new TransactionManager(indexer);

async function createBridgeCell(bridgeLockscript: any, indexer: Indexer) {
  let txSkeleton = TransactionSkeleton({ cellProvider: indexer });
  const infos = require('./infos.json');
  const multisigType = infos.type;
  const cellCollector = new CellCollector(indexer, {
    type: multisigType,
  });
  console.log('-------------------');
  const cells = cellCollector.collect();
  for await (const cell of cells) {
    console.log(cell);
  }
  console.log('-------------------');
  txSkeleton = await common.setupInputCell(txSkeleton, cells[0], multisigScript);
  const bridgeCellCapacity = 200n * 10n ** 8n;
  const output = <Cell>{
    cell_output: {
      capacity: `0x${bridgeCellCapacity.toString(16)}`,
      lock: bridgeLockscript,
    },
    data: '0x',
  };
  txSkeleton = txSkeleton.update('outputs', (outputs) => {
    return outputs.push(output);
  });
  const needCapacity = BigInt(output.cell_output.capacity);

  if (needCapacity !== 0n) {
    txSkeleton = await common.injectCapacity(txSkeleton, [fromAddress], needCapacity);
  }
  // console.log('txSkeleton:', JSON.stringify(txSkeleton, null, 2));
  const feeRate = BigInt(1000);
  txSkeleton = await common.payFeeByFeeRate(txSkeleton, [fromAddress], feeRate);
  txSkeleton = common.prepareSigningEntries(txSkeleton);
  // txSkeleton = common.prepareSigningEntries(txSkeleton);
  console.log('signingEntries length:', txSkeleton.get('signingEntries').size);
  const message0 = txSkeleton.get('signingEntries').get(0).message;
  const content0 = key.signRecoverable(message0, fromPrivateKey);
  const message1 = txSkeleton.get('signingEntries').get(1).message;
  let content1 = serializedMultisigScript;
  for (let i = 0; i < 2; i++) {
    content1 += key.signRecoverable(message1, keys[i]).slice(2);
  }
  const tx = sealTransaction(txSkeleton, [content0, content1]);
  console.log('tx:', JSON.stringify(tx, null, 2));
  const txHash = await transactionManager.send_transaction(tx);
  await waitUntilCommitted(ckb, txHash, 60);
}

async function waitUntilCommitted(ckb, txHash, timeout) {
  let waitTime = 0;
  while (true) {
    const txStatus = await ckb.rpc.getTransaction(txHash);
    console.log(`tx ${txHash} status: ${txStatus.txStatus.status}, index: ${waitTime}`);
    if (txStatus.txStatus.status === 'committed') {
      return txStatus;
    }
    await asyncSleep(1000);
    waitTime += 1;
    if (waitTime >= timeout) {
      return txStatus;
    }
  }
}

function asyncSleep(ms = 0) {
  return new Promise((r) => setTimeout(r, ms));
}
