import path from 'path';
import { HashType, Script } from '@ckb-lumos/base';
import { common } from '@ckb-lumos/common-scripts';
import { key } from '@ckb-lumos/hd';
import { TransactionSkeleton, sealTransaction, minimalCellCapacity, generateAddress } from '@ckb-lumos/helpers';
import { RPC } from '@ckb-lumos/rpc';
import TransactionManager from '@ckb-lumos/transaction-manager';
import CKB from '@nervosnetwork/ckb-sdk-core';
import * as lodash from 'lodash';
import nconf from 'nconf';
import { Config, MultisigItem } from '../../../config';
import { getFromEnv, asyncSleep as sleep, parsePrivateKey, writeJsonToFile } from '../../../utils';
import { CkbIndexer } from '../indexer';
import { initLumosConfig } from '../init_lumos_config';
import { getMultisigLock, privateKeyToAddress } from './multisig_helper';
import { generateTypeIDScript } from './typeid';

const CKB_URL = process.env.CKB_URL || 'http://127.0.0.1:8114';
const CKB_INDEXER_URL = process.env.CKB_INDEXER_URL || 'http://127.0.0.1:8116';
initLumosConfig();
const acpData = '0x';
const ckb = new CKB(CKB_URL);
const ckbRpc = new RPC(CKB_URL);
const indexer = new CkbIndexer(CKB_URL, CKB_INDEXER_URL);
const transactionManager = new TransactionManager(indexer);

function getOwnerCellCapacity(lock: Script) {
  const output = {
    cell_output: {
      lock,
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

function getMultiSigCellCapacity(lock: Script) {
  const output = {
    cell_output: {
      lock,
      capacity: '0x0',
    },
    data: acpData,
  };

  const min = minimalCellCapacity(output);
  return min;
}

async function deploy(ckbPrivateKey: string, multisigItem: MultisigItem) {
  const fromPrivateKey = parsePrivateKey(ckbPrivateKey);
  const fromAddress = privateKeyToAddress(fromPrivateKey);
  const multisigLockscript = getMultisigLock(multisigItem);
  console.log(`multisigLockscript: ${JSON.stringify(multisigLockscript, null, 2)}`);
  const multisigAddress = generateAddress(multisigLockscript);

  let txSkeleton = TransactionSkeleton({ cellProvider: indexer });
  const ownerCellCapacity = getOwnerCellCapacity(multisigLockscript);
  const multiSigCellCapacity = getMultiSigCellCapacity(multisigLockscript);
  const capacity = ownerCellCapacity + multiSigCellCapacity;
  txSkeleton = await common.transfer(txSkeleton, [fromAddress], multisigAddress, capacity);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const multiSigCellOutput = txSkeleton.get('outputs').get(0)!;
  multiSigCellOutput.data = acpData;
  multiSigCellOutput.cell_output.capacity = `0x${multiSigCellCapacity.toString(16)}`;
  txSkeleton = txSkeleton.update('outputs', (outputs) => {
    return outputs.set(0, multiSigCellOutput);
  });
  // owner cell
  const firstInput = {
    previous_output: txSkeleton.get('inputs').get(0)!.out_point,
    since: '0x0',
  };
  const typeIDScript = generateTypeIDScript(firstInput, '0x2');
  const ownerCellOutput = lodash.cloneDeep(multiSigCellOutput);
  ownerCellOutput.cell_output.type = typeIDScript;
  ownerCellOutput.cell_output.capacity = `0x${ownerCellCapacity.toString(16)}`;
  txSkeleton = txSkeleton.update('outputs', (outputs) => {
    return outputs.set(2, ownerCellOutput);
  });
  console.dir(txSkeleton, { depth: null });
  const feeRate = 1000n;
  txSkeleton = await common.payFeeByFeeRate(txSkeleton, [fromAddress], feeRate);
  txSkeleton = common.prepareSigningEntries(txSkeleton);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const message = txSkeleton.get('signingEntries').get(0)!.message;
  const content = key.signRecoverable(message, fromPrivateKey);

  const tx = sealTransaction(txSkeleton, [content]);
  console.log('tx:', JSON.stringify(tx, null, 2));
  const txHash = await transactionManager.send_transaction(tx);
  await waitUntilCommitted(ckb, txHash, 60);
  console.log('multi lockscript:', JSON.stringify(multisigLockscript, null, 2));
  const rpcTipNumber = parseInt((await ckbRpc.get_tip_header()).number, 16);
  return {
    multisigLockscript,
    ownerCellTypescript: typeIDScript,
    startBlockHeight: rpcTipNumber,
  };
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
  const ckbPrivateKey = getFromEnv('CKB_PRIV_KEY');
  const multisigConfigPath = getFromEnv('MULTISIG_CONFIG_PATH');
  nconf.file({ file: multisigConfigPath });
  const multisigScript: MultisigItem = nconf.get('forceBridge:ckb:multisigScript');
  console.dir(multisigScript, { depth: null });
  const res = await deploy(ckbPrivateKey, multisigScript);
  const obj = { forceBridge: { ckb: res } };
  console.dir(obj, { depth: null });
  const outputConfigPath = getFromEnv('CONFIG_PATH', '/tmp/force-bridge');
  const ckbOwnerCellConfigPath = path.join(outputConfigPath, 'ckb_owner_cell_config.json');
  writeJsonToFile(obj, ckbOwnerCellConfigPath);
  console.log(`ckb owner cell config written to ${ckbOwnerCellConfigPath}`);
  console.log('\n\n\n---------end init multisig address -----------\n');
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
