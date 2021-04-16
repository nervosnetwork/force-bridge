import { Indexer, CellCollector } from '@ckb-lumos/indexer';
import { init } from './init_config';
import {
  TransactionSkeleton,
  sealTransaction,
  parseAddress,
  minimalCellCapacity,
  TransactionSkeletonType,
} from '@ckb-lumos/helpers';
import { Cell, Hash, HashType, HexString, OutPoint, Script } from '@ckb-lumos/base';
import { writeFileSync } from 'fs';
import {
  fromAddress,
  multisigAddress,
  fromPrivateKey,
  multisigScript,
  multisigLockScript,
  serializedMultisigScript,
  fromLockScript,
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
const dataDir = './lumos_db';
const indexer = new Indexer('http://127.0.0.1:8114', dataDir);
const keys = [
  '0xd00c06bfd800d27397002dca6fb0993d5ba6399b4238b2f29ee9deb97593d2bc',
  '0x63d86723e08f0f813a36ce6aa123bb2289d90680ae1e99d4de8cdb334553f24d',
];
indexer.startForever();

const transactionManager = new TransactionManager(indexer);
// const indexer = new Indexer('http://127.0.0.1:8114', './indexer-data');
// const transactionManager = new TransactionManager(indexer);
// transactionManager.start();

function getDataOutputCapacity() {
  const output = {
    cell_output: {
      lock: parseAddress(multisigAddress),
      type: {
        code_hash: '0x' + '0'.repeat(64),
        hash_type: 'type' as HashType,
        args: '0x' + '0'.repeat(64),
      },
      capacity: '0x0',
    },
    data: acpData,
  };

  const min = minimalCellCapacity(output);
  return min;
}

async function deploy() {
  // const pubkey = key.privateToPublic('0x63d86723e08f0f813a36ce6aa123bb2289d90680ae1e99d4de8cdb334553f24d');
  // const pubkeyHash = key.publicKeyToBlake160(pubkey);
  // console.log('pubkeyHash:', pubkeyHash);
  let txSkeleton = TransactionSkeleton({ cellProvider: indexer });
  const capacity = getDataOutputCapacity();
  console.log('capacity:', capacity);
  await asyncSleep(5 * 1000);
  // const bridgeCellCapacity = 200n * 10n ** 8n;
  // const fee = 10000n;
  // const inputCells = [];
  // const needCap = capacity + fee;
  // let actualCap = 0n;
  // const cellCollector = new CellCollector(indexer, {
  //   lock: fromLockScript,
  //   data: '0x',
  // });
  // for await (const cell of cellCollector.collect()) {
  //   inputCells.push(cell);
  //   actualCap += BigInt(cell.cell_output.capacity);
  //   if (actualCap > needCap) {
  //     break;
  //   }
  // }
  // for (const cell of inputCells) {
  //   txSkeleton = txSkeleton.update('inputs', (inputs) => {
  //     return inputs.push(cell);
  //   });
  // }
  console.log('before transfer txSkeleton:', JSON.stringify(txSkeleton, null, 2));
  txSkeleton = await common.transfer(txSkeleton, [fromAddress], multisigAddress, capacity);
  console.log('after transfer txSkeleton:', JSON.stringify(txSkeleton, null, 2));
  const firstOutput = txSkeleton.get('outputs').get(0);
  firstOutput.data = acpData;
  const firstInput = {
    previous_output: txSkeleton.get('inputs').get(0).out_point,
    since: '0x0',
  };
  const typeIDScript = generateTypeIDScript(firstInput, '0x0');
  const typeScriptHash = utils.computeScriptHash(typeIDScript);
  firstOutput.cell_output.type = typeIDScript;
  txSkeleton = txSkeleton.update('outputs', (outputs) => {
    return outputs.set(0, firstOutput);
  });
  // const outputMultisig = <Cell>{
  //   cell_output: {
  //     capacity: `0x${capacity.toString(16)}`,
  //     lock: multisigLockScript,
  //     type: typeIDScript,
  //   },
  //   data: '0x',
  // };
  // firstOutput.cell_output.type = typeIDScript;
  // txSkeleton = txSkeleton.update('outputs', (outputs) => {
  //   return outputs.push(outputMultisig);
  // });
  // const fee = BigInt(1000);
  // const changeCap = getInputCap(txSkeleton) - getOutputCap(txSkeleton);
  // if (changeCap > 64n * 10n ** 8n) {
  //   const changeCell = <Cell>{
  //     cell_output: {
  //       capacity: `0x${changeCap.toString(16)}`,
  //       lock: fromLockScript,
  //     },
  //     data: '0x',
  //   };
  //   txSkeleton = txSkeleton.update('outputs', (outputs) => {
  //     return outputs.push(changeCell);
  //   });
  // }
  const feeRate = 1000n;
  // console.log('txSkeleton:', JSON.stringify(txSkeleton, null, 2));
  txSkeleton = await common.payFeeByFeeRate(txSkeleton, [fromAddress], feeRate);
  console.log('after payFeeByFeeRate:');
  console.log('txSkeleton:', JSON.stringify(txSkeleton, null, 2));
  txSkeleton = common.prepareSigningEntries(txSkeleton);
  console.log('prepareSigningEntries:');
  console.log('txSkeleton:', JSON.stringify(txSkeleton, null, 2));
  const message = txSkeleton.get('signingEntries').get(0).message;
  console.log('messages:', txSkeleton.get('signingEntries'));
  console.log('message:', message);
  const content = key.signRecoverable(message, fromPrivateKey);
  console.log('content:', content);

  const tx = sealTransaction(txSkeleton, [content]);
  console.log('tx:', JSON.stringify(tx, null, 2));
  // const txHash = await ckb.rpc.sendTransaction(tx);

  const txHash = await transactionManager.send_transaction(tx);
  console.log('txHash:', txHash);
  await waitUntilCommitted(ckb, txHash, 60);

  console.log('-'.repeat(10) + 'acp cell info' + '-'.repeat(10));
  console.log('txHash:', txHash);
  console.log('index:', '0x0');
  console.log('type id:', typeScriptHash);

  const result = JSON.stringify(
    {
      tx_hash: txHash,
      index: '0x0',
      type: typeIDScript,
    },
    null,
    2,
  );
  // const infos = require('./infos.json');
  // const multisigType = deployResult.type;
  // writeFileSync('./src/packages/ckb/tx-helper/multisig/deploy_result.json', infos);
  nconf.set('type', typeIDScript);
  nconf.save();

  // const deployResult = require('./deploy_result.json');
  // const multisigType = deployResult.type;
  console.log('result already write to file `deploy_result.json`');
  console.log('multi lockscript:', JSON.stringify(multisigLockScript, null, 2));
  // txSkeleton = TransactionSkeleton({ cellProvider: indexer });
  // await asyncSleep(5 * 1000);
  // const cellCollector = new CellCollector(indexer, {
  //   type: typeIDScript,
  // });
  // console.log('-------------------');
  // for await (const cell of cellCollector.collect()) {
  //   console.log(cell);
  // }
  // console.log('-------------------');
  // txSkeleton = await common.setupInputCell(
  //   txSkeleton,
  //   <Cell>{
  //     cell_output: {
  //       capacity: tx.outputs[0].capacity,
  //       lock: tx.outputs[0].lock,
  //       type: tx.outputs[0].type,
  //     },
  //     data: tx.outputs_data[0],
  //     out_point: <OutPoint>{
  //       tx_hash: tx.hash as Hash,
  //       index: '0x0',
  //     },
  //   },
  //   multisigScript,
  // );
  // console.log('txSkeleton:', JSON.stringify(txSkeleton, null, 2));
  // capacity = getDataOutputCapacity();
  // console.log('capacity:', capacity);
  // await asyncSleep(5 * 1000);
  // const bridgeCellCapacity = 200n * 10n ** 8n;
  // const output = <Cell>{
  //   cell_output: {
  //     capacity: `0x${bridgeCellCapacity.toString(16)}`,
  //     lock: tx.outputs[0].lock,
  //   },
  //   data: '0x',
  // };
  // txSkeleton = txSkeleton.update('outputs', (outputs) => {
  //   return outputs.push(output);
  // });
  // const needCapacity = BigInt(output.cell_output.capacity);
  //
  // if (needCapacity !== 0n) {
  //   txSkeleton = await common.injectCapacity(txSkeleton, [fromAddress], needCapacity);
  // }
  // // txSkeleton.outputs.push(<Cell>{
  // //   cell_output: {
  // //     capacity: `0x${bridgeCellCapacity.toString(16)}`,
  // //     lock: tx.outputs[0].lock,
  // //   },
  // //   data: '0x',
  // // });
  // console.log('capacity:', `0x${bridgeCellCapacity.toString(16)}`);
  // // txSkeleton = await common.transfer(txSkeleton, [fromAddress, multisigScript], fromAddress, capacity);
  // console.log('txSkeleton:', JSON.stringify(txSkeleton, null, 2));
  // txSkeleton = await common.payFeeByFeeRate(txSkeleton, [fromAddress], feeRate);
  // txSkeleton = common.prepareSigningEntries(txSkeleton);
  // // txSkeleton = common.prepareSigningEntries(txSkeleton);
  // console.log('signingEntries length:', txSkeleton.get('signingEntries').size);
  // const message0 = txSkeleton.get('signingEntries').get(0).message;
  // const content0 = key.signRecoverable(message0, fromPrivateKey);
  // const message1 = txSkeleton.get('signingEntries').get(1).message;
  // let content1 = serializedMultisigScript;
  // for (let i = 0; i < 2; i++) {
  //   content1 += key.signRecoverable(message1, keys[i]).slice(2);
  // }
  // // const content1 = key.signRecoverable(message1, fromPrivateKey);
  // // const content2 = key.signRecoverable(message1, key2);
  // // const content2 = key.signRecoverable(message, key3);
  // const tx1 = sealTransaction(txSkeleton, [content0, content1]);
  // console.log('tx1:', JSON.stringify(tx1, null, 2));
  // const txHash1 = await transactionManager.send_transaction(tx1);
  // console.log('txHash1:', txHash1);
  // await waitUntilCommitted(ckb, txHash1, 60);
  // TODO: disable dep group
  // dep group
  // await generateDepGroupTx({
  //   tx_hash: txHash,
  //   index: "0x0",
  // });

  process.exit(0);
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

const main = async () => {
  console.log('\n\n\n---------start deploy -----------\n');
  // await indexer.waitForSync();
  const configPath = './src/packages/ckb/tx-helper/multisig/infos.json';
  nconf.env().file({ file: configPath });
  await deploy();
  console.log('\n\n\n---------end deploy -----------\n');
  process.exit(0);
};

main();
