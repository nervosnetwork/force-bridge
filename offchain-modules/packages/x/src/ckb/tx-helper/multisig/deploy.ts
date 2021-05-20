import { HashType } from '@ckb-lumos/base';
import { common } from '@ckb-lumos/common-scripts';
import { key } from '@ckb-lumos/hd';
import { TransactionSkeleton, sealTransaction, parseAddress, minimalCellCapacity } from '@ckb-lumos/helpers';
import { Indexer } from '@ckb-lumos/indexer';
import { RPC } from '@ckb-lumos/rpc';
import TransactionManager from '@ckb-lumos/transaction-manager';
import CKB from '@nervosnetwork/ckb-sdk-core';
import nconf from 'nconf';
import { Config } from '../../../config';
import { ForceBridgeCore } from '../../../core';
import { asyncSleep as sleep } from '../../../utils';
import { init } from './init_config';
import { getFromAddr, getMultisigAddr, getMultisigLock } from './multisig_helper';
import { generateTypeIDScript } from './typeid';

const CKB_URL = process.env.CKB_URL || 'http://127.0.0.1:8114';
init();

const acpData = '0x';
const ckb = new CKB(CKB_URL);
const dataDir = './lumos_db';
const indexer = new Indexer(CKB_URL, dataDir);
indexer.startForever();
const transactionManager = new TransactionManager(indexer);

function getDataOutputCapacity() {
  const output = {
    cell_output: {
      lock: parseAddress(getMultisigAddr(ForceBridgeCore.config.ckb.multisigScript)),
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
  const fromPrivateKey = ForceBridgeCore.config.ckb.fromPrivateKey;
  const fromAddress = getFromAddr();
  const multisigLockScript = getMultisigLock(ForceBridgeCore.config.ckb.multisigScript);
  const multisigAddress = getMultisigAddr(ForceBridgeCore.config.ckb.multisigScript);

  let txSkeleton = TransactionSkeleton({ cellProvider: indexer });
  const capacity = getDataOutputCapacity();
  txSkeleton = await common.transfer(txSkeleton, [fromAddress], multisigAddress, capacity);
  const firstOutput = txSkeleton.get('outputs').get(0);
  firstOutput.data = acpData;
  const firstInput = {
    previous_output: txSkeleton.get('inputs').get(0).out_point,
    since: '0x0',
  };
  const typeIDScript = generateTypeIDScript(firstInput, '0x0');
  firstOutput.cell_output.type = typeIDScript;
  txSkeleton = txSkeleton.update('outputs', (outputs) => {
    return outputs.set(0, firstOutput);
  });
  const feeRate = 1000n;
  txSkeleton = await common.payFeeByFeeRate(txSkeleton, [fromAddress], feeRate);
  txSkeleton = common.prepareSigningEntries(txSkeleton);
  const message = txSkeleton.get('signingEntries').get(0).message;
  const content = key.signRecoverable(message, fromPrivateKey);

  const tx = sealTransaction(txSkeleton, [content]);
  console.log('tx:', JSON.stringify(tx, null, 2));
  const txHash = await transactionManager.send_transaction(tx);
  await waitUntilCommitted(ckb, txHash, 60);

  nconf.set('forceBridge:ckb:multisigType', typeIDScript);
  nconf.save();

  console.log('multi lockscript:', JSON.stringify(multisigLockScript, null, 2));
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

async function waitUntilSync(): Promise<void> {
  const ckbRpc = new RPC(CKB_URL);
  const rpcTipNumber = parseInt((await ckbRpc.get_tip_header()).number, 16);
  console.log('rpcTipNumber', rpcTipNumber);
  const index = 0;
  while (true) {
    const tip = await indexer.tip();
    console.log('tip', tip);
    if (tip == undefined) {
      await sleep(1000);
      continue;
    }
    const indexerTipNumber = parseInt((await indexer.tip()).block_number, 16);
    console.log('indexerTipNumber', indexerTipNumber);
    if (indexerTipNumber >= rpcTipNumber) {
      return;
    }
    console.log(`wait until indexer sync. index: ${index}`);
    await sleep(1000);
  }
}

function asyncSleep(ms = 0) {
  return new Promise((r) => setTimeout(r, ms));
}

const main = async () => {
  console.log('\n\n\n---------start init multisig address -----------\n');
  await waitUntilSync();
  const configPath = './config.json';
  nconf.env().file({ file: configPath });
  const config: Config = nconf.get('forceBridge');
  console.log('config: ', config);
  await new ForceBridgeCore().init(config);
  await deploy();
  console.log('\n\n\n---------end init multisig address -----------\n');
  process.exit(0);
};

main();
