// todo: remove lumos indexer dep, use collector in packages/ckb/tx-helper/collector
import { blake2b, asyncSleep as sleep } from '../packages/utils';

const fs = require('fs').promises;
const nconf = require('nconf');
const CKB = require('@nervosnetwork/ckb-sdk-core').default;
const utils = require('@nervosnetwork/ckb-sdk-utils');
const { Indexer, CellCollector } = require('@ckb-lumos/indexer');

const CKB_URL = process.env.CKB_URL || 'http://127.0.0.1:8114';
const ckb = new CKB(CKB_URL);
const configPath = './config.json';

const LUMOS_DB = './lumos_db';
const indexer = new Indexer(CKB_URL, LUMOS_DB);
indexer.startForever();

const PRI_KEY = process.env.PRI_KEY || '0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe';
const PUB_KEY = ckb.utils.privateKeyToPublicKey(PRI_KEY);
const ARGS = `0x${ckb.utils.blake160(PUB_KEY, 'hex')}`;
const ADDRESS = ckb.utils.pubkeyToAddress(PUB_KEY);

const deploy = async () => {
  const lockscriptBin = await fs.readFile('../ckb-contracts/build/release/bridge-lockscript');
  const lockscriptCodeHash = utils.bytesToHex(blake2b(lockscriptBin));
  console.log('lockscriptCodeHash:', lockscriptCodeHash);
  const recipientTypescriptBin = await fs.readFile('../ckb-contracts/build/release/recipient-typescript');
  const recipientTypescriptCodeHash = utils.bytesToHex(blake2b(recipientTypescriptBin));
  console.log('recipientTypescriptCodeHash:', recipientTypescriptCodeHash);
  const sudtBin = await fs.readFile('./deps/simple_udt');
  const sudtCodeHash = utils.bytesToHex(blake2b(sudtBin));
  // console.dir({lockscriptCodeHash, sudtCodeHash}, {depth: null})
  const contractBinLength = BigInt(lockscriptBin.length);
  console.log({ contractBinLength });
  const { secp256k1Dep } = await ckb.loadDeps();
  const lock = { ...secp256k1Dep, args: ARGS };
  // nconf.set('userLockscript', lock);
  const cells = await ckb.loadCells({ indexer, CellCollector, lock });
  const emptyCells = cells.filter((cell) => cell.data === '0x');
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
  console.dir({ rawTx }, { depth: null });

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

const main = async () => {
  console.log('\n\n\n---------start deploy -----------\n');
  await indexer.waitForSync();
  nconf.env().file({ file: configPath });
  await deploy();
  console.log('\n\n\n---------end deploy -----------\n');
  process.exit(0);
};

main();
