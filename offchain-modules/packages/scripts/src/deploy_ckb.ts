/* eslint-disable @typescript-eslint/no-var-requires */
// todo: remove lumos indexer dep, use collector in packages/ckb/tx-helper/collector
import { promises as fs } from 'fs';
import path from 'path';
import { Asset, BtcAsset, ChainType, EosAsset, EthAsset, TronAsset } from '@force-bridge/x/dist/ckb/model/asset';
import { IndexerCollector } from '@force-bridge/x/dist/ckb/tx-helper/collector';
import { CkbTxGenerator } from '@force-bridge/x/dist/ckb/tx-helper/generator';
import { CkbIndexer } from '@force-bridge/x/dist/ckb/tx-helper/indexer';
import { asyncSleep as sleep, blake2b } from '@force-bridge/x/dist/utils';

import { OutPoint, Script } from '@lay2/pw-core';
import RawTransactionParams from '@nervosnetwork/ckb-sdk-core';
import * as utils from '@nervosnetwork/ckb-sdk-utils';
import axios from 'axios';
import nconf from 'nconf';
import { RPCClient } from 'rpc-bitcoin';

const configPath = './config.json';
nconf.env().file({ file: configPath });
const CKB_URL = nconf.get('forceBridge:ckb:ckbRpcUrl');
const CKB_IndexerURL = nconf.get('forceBridge:ckb:ckbIndexerUrl');
const PRI_KEY = nconf.get('forceBridge:ckb:privateKey');
const ckb = new RawTransactionParams(CKB_URL);
const generator = new CkbTxGenerator(ckb, new IndexerCollector(new CkbIndexer(CKB_URL, CKB_IndexerURL)));
const PUB_KEY = ckb.utils.privateKeyToPublicKey(PRI_KEY);
const ARGS = `0x${ckb.utils.blake160(PUB_KEY, 'hex')}`;
const ADDRESS = ckb.utils.pubkeyToAddress(PUB_KEY);

const PATH_PROJECT_ROOT = path.join(__dirname, '../../../..');

function pathFromProjectRoot(subPath: string): string {
  return path.join(PATH_PROJECT_ROOT, subPath);
}

const PATH_SUDT_DEP = pathFromProjectRoot('/offchain-modules/deps/simple_udt');
const PATH_RECIPIENT_TYPESCRIPT = pathFromProjectRoot('/ckb-contracts/build/release/recipient-typescript');
const PATH_BRIDGE_LOCKSCRIPT = pathFromProjectRoot('/ckb-contracts/build/release/bridge-lockscript');

async function getCells(script_args: string, indexerUrl: string): Promise<RawTransactionParams.Cell[]> {
  const cells = [];
  const postData = {
    id: 2,
    jsonrpc: '2.0',
    method: 'get_cells',
    params: [
      {
        script: {
          code_hash: '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8',
          hash_type: 'type',
          args: script_args,
        },
        script_type: 'lock',
      },
      'asc',
      '0x64',
    ],
  };
  let response;
  while (response === '' || response === undefined || response == null) {
    try {
      const res = await axios.post(`${indexerUrl}`, postData);
      response = res.data.result;
    } catch (error) {
      console.error('failed to get indexer data', error);
    }
    await sleep(5 * 1000);
  }
  const rawCells = response.objects;
  console.log('inderer post response', rawCells);
  for (const rawCell of rawCells) {
    const cell: RawTransactionParams.Cell = {
      capacity: rawCell.output.capacity,
      lock: Script.fromRPC(rawCell.output.lock),
      type: Script.fromRPC(rawCell.output.type),
      outPoint: OutPoint.fromRPC(rawCell.out_point),
      data: rawCell.output_data,
    };
    cells.push(cell);
  }
  return cells.filter((c) => c.data === '0x' && !c.type);
}

function getPreDeployedAssets() {
  const ownerLockHash = nconf.get('forceBridge:ckb:ownerLockHash');
  return [
    new BtcAsset('btc', ownerLockHash),
    new EthAsset('0x0000000000000000000000000000000000000000', ownerLockHash),
    new TronAsset('trx', ownerLockHash),
    new EosAsset('EOS', ownerLockHash),
  ];
}

async function createBridgeCell(assets: Asset[]) {
  const { secp256k1Dep } = await ckb.loadDeps();

  const lockscript = Script.fromRPC({
    code_hash: secp256k1Dep.codeHash,
    args: ARGS,
    hash_type: secp256k1Dep.hashType,
  });

  const bridgeLockScripts = [];
  for (const asset of assets) {
    bridgeLockScripts.push({
      codeHash: nconf.get('forceBridge:ckb:deps:bridgeLock:script:codeHash'),
      hashType: 'data',
      args: asset.toBridgeLockscriptArgs(),
    });
  }
  const rawTx = await generator.createBridgeCell(lockscript, bridgeLockScripts);
  const signedTx = ckb.signTransaction(PRI_KEY)(rawTx);
  const tx_hash = await ckb.rpc.sendTransaction(signedTx);
  const txStatus = await waitUntilCommitted(tx_hash);
  console.log('pre deploy assets tx status', txStatus);
}

const deploy = async () => {
  const lockscriptBin = await fs.readFile(PATH_BRIDGE_LOCKSCRIPT);
  const lockscriptCodeHash = utils.bytesToHex(blake2b(lockscriptBin));
  console.log('lockscriptCodeHash:', lockscriptCodeHash);
  const recipientTypescriptBin = await fs.readFile(PATH_RECIPIENT_TYPESCRIPT);
  const recipientTypescriptCodeHash = utils.bytesToHex(blake2b(recipientTypescriptBin));
  console.log('recipientTypescriptCodeHash:', recipientTypescriptCodeHash);
  const sudtBin = await fs.readFile(PATH_SUDT_DEP);
  const sudtCodeHash = utils.bytesToHex(blake2b(sudtBin));
  // console.dir({lockscriptCodeHash, sudtCodeHash}, {depth: null})
  const contractBinLength = BigInt(lockscriptBin.length);
  console.log({ contractBinLength });
  const { secp256k1Dep } = await ckb.loadDeps();
  const unspentCells = await getCells(ARGS, CKB_IndexerURL);
  console.log('unspentCells', unspentCells);

  const emptyCells = [];
  for (let i = 0; i < unspentCells.length; i++) {
    const res = await ckb.rpc.getLiveCell(unspentCells[i].outPoint, false);
    console.log('cell capacity: ', res.cell.output.capacity, ' cell status: ', res.status);
    if (res.status === 'live') {
      emptyCells.push(unspentCells[i]);
    }
  }
  console.log('emptyCells', JSON.stringify(emptyCells, null, 2));

  console.dir({ emptyCells }, { depth: null });
  const rawTx = ckb.generateRawTransaction({
    fromAddress: ADDRESS,
    toAddress: ADDRESS,
    capacity: (contractBinLength + 100n) * 10n ** 8n,
    fee: 10000000n,
    safeMode: true,
    cells: emptyCells,
    outputsData: [utils.bytesToHex(lockscriptBin)],
    deps: secp256k1Dep,
  });
  // add sudt
  const sudtCodeCellCapacity = (BigInt(sudtBin.length) + 100n) * 10n ** 8n;
  rawTx.outputs.push({
    ...rawTx.outputs[0],
    capacity: `0x${sudtCodeCellCapacity.toString(16)}`,
  });
  rawTx.outputsData.push(utils.bytesToHex(sudtBin));
  // add recipient typescript
  const recipientTypescriptCodeCellCapacity = (BigInt(recipientTypescriptBin.length) + 100n) * 10n ** 8n;
  rawTx.outputs.push({
    ...rawTx.outputs[0],
    capacity: `0x${recipientTypescriptCodeCellCapacity.toString(16)}`,
  });
  rawTx.outputsData.push(utils.bytesToHex(recipientTypescriptBin));
  // // create bridge cell
  // const bridgeCellCapacity = 100n * 10n ** 8n;
  // const bridgeCellLockscript = {
  //     codeHash: lockscriptCodeHash,
  //     hashType: 'data',
  //     args: BRIDGE_CELL_LOCKSCRIPT_ARGS,
  // };
  // const bridgeCellLockscriptHash = ckb.utils.scriptToHash(bridgeCellLockscript);
  // nconf.set('bridgeCellLockscript', bridgeCellLockscript);
  // nconf.set('bridgeCellLockscriptHash', bridgeCellLockscriptHash);
  // rawTx.outputs.push({
  //     lock: bridgeCellLockscript,
  //     capacity: `0x${bridgeCellCapacity.toString(16)}`,
  // });
  // rawTx.outputsData.push('0x');
  // modify change cell
  const changeCellCap = BigInt(rawTx.outputs[1].capacity) - sudtCodeCellCapacity - recipientTypescriptCodeCellCapacity;
  rawTx.outputs[1].capacity = `0x${changeCellCap.toString(16)}`;
  // console.dir({ rawTx }, { depth: null });

  // return
  const signedTx = ckb.signTransaction(PRI_KEY)(rawTx);
  const deployTxHash = await ckb.rpc.sendTransaction(signedTx);
  console.log(`Transaction has been sent with tx hash ${deployTxHash}`);
  const txStatus = await waitUntilCommitted(deployTxHash);
  // console.dir({ txStatus }, {depth: null})
  // nconf.set('deployTxHash', deployTxHash);
  const scriptsInfo = {
    bridgeLock: {
      cellDep: {
        depType: 'code',
        outPoint: {
          txHash: deployTxHash,
          index: '0x0',
        },
      },
      script: {
        codeHash: lockscriptCodeHash,
        hashType: 'data',
      },
    },
    sudtType: {
      cellDep: {
        depType: 'code',
        outPoint: {
          txHash: deployTxHash,
          index: '0x2',
        },
      },
      script: {
        codeHash: sudtCodeHash,
        hashType: 'data',
      },
    },
    recipientType: {
      cellDep: {
        depType: 'code',
        outPoint: {
          txHash: deployTxHash,
          index: '0x3',
        },
      },
      script: {
        codeHash: recipientTypescriptCodeHash,
        hashType: 'data',
      },
    },
  };
  nconf.set('forceBridge:ckb:deps', scriptsInfo);
  nconf.save();
};

const waitUntilCommitted = async (txHash) => {
  let waitTime = 0;
  while (true) {
    const txStatus = await ckb.rpc.getTransaction(txHash);
    console.log(`tx ${txHash} status: ${txStatus.txStatus.status}, index: ${waitTime}`);
    if (txStatus.txStatus.status === 'committed') {
      return txStatus;
    }
    await sleep(1000);
    waitTime += 1;
  }
};
const setStartTime = async () => {
  const ckb_tip = await ckb.rpc.getTipBlockNumber();
  console.debug(`ckb start height is ${parseInt(ckb_tip, 10)}`);
  nconf.set('forceBridge:ckb:startBlockHeight', parseInt(ckb_tip, 10));
  nconf.save();
};

async function setOwnerLockHash() {
  const { secp256k1Dep } = await ckb.loadDeps();

  const lockscript = Script.fromRPC({
    code_hash: secp256k1Dep.codeHash,
    args: ARGS,
    hash_type: secp256k1Dep.hashType,
  });
  const ownerLockHash = ckb.utils.scriptToHash(<CKBComponents.Script>lockscript);
  console.log('ownerLockHash', ownerLockHash);
  nconf.set('forceBridge:ckb:ownerLockHash', ownerLockHash);
  nconf.save();
}

const setXChainStartTime = async () => {
  const btcRPCParams = nconf.get('forceBridge:btc:clientParams');
  const btcRPCClient = new RPCClient(btcRPCParams);
  const height = await btcRPCClient.getchaintips();
  console.log(`btc start block is ${height[0].height}`);
  nconf.set('forceBridge:btc:startBlockHeight', height[0].height);
  nconf.save();
};

const main = async () => {
  console.log('\n\n\n---------start deploy -----------\n');
  await deploy();
  await setStartTime();
  await setOwnerLockHash();

  const assets = getPreDeployedAssets();
  await createBridgeCell(assets);

  await setXChainStartTime();

  console.log('\n\n\n---------end deploy -----------\n');
  process.exit(0);
};

main();
