import { promises as fs } from 'fs';
import { IndexerCollector as CellCollector } from '@force-bridge/x/dist/ckb/tx-helper/collector';
import { asserts } from '@force-bridge/x';
import { CkbIndexer } from '@force-bridge/x/dist/ckb/tx-helper/indexer';
import CKB from '@nervosnetwork/ckb-sdk-core';
import * as utils from '@nervosnetwork/ckb-sdk-utils';
import nconf from 'nconf';

const configPath = './config.json';
const CKB_URL = process.env.CKB_URL || 'http://127.0.0.1:8114';
const CKB_INDEXER_URL = process.env.CKB_INDEXER_URL || 'http://127.0.0.1:8116';
nconf.get('forceBridge:ckb:fromPrivateKey');
const ckb = new CKB(CKB_URL);
const indexer = new CkbIndexer(CKB_URL, CKB_INDEXER_URL);

// private key for demo, don't expose it in production
const PRI_KEY = process.env.PRI_KEY || '0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe';
const PUB_KEY = ckb.utils.privateKeyToPublicKey(PRI_KEY);
const ARGS = `0x${ckb.utils.blake160(PUB_KEY, 'hex')}`;
const ADDRESS = ckb.utils.pubkeyToAddress(PUB_KEY);

console.log({ ADDRESS });

const BRIDGE_CELL_LOCKSCRIPT_ARGS = '0x0102';

const deploy = async () => {
  const lockscriptBin = await fs.readFile('../ckb-contracts/build/release/bridge-lockscript');
  const lockscriptCodeHash = utils.bytesToHex(blake2b(lockscriptBin));
  const sudtBin = await fs.readFile('./deps/simple_udt');
  const sudtCodeHash = utils.bytesToHex(blake2b(sudtBin));
  // console.dir({lockscriptCodeHash, sudtCodeHash}, {depth: null})
  const contractBinLength = BigInt(lockscriptBin.length);
  console.log({ contractBinLength });
  const { secp256k1Dep } = await ckb.loadDeps();
  asserts(secp256k1Dep);
  console.log('secp256k1Dep', JSON.stringify(secp256k1Dep, null, 2));
  const lock = { ...secp256k1Dep, args: ARGS };
  nconf.set('userLockscript', lock);
  const cells = await ckb.loadCells({ indexer, CellCollector, lock });
  const emptyCells = cells.filter((cell) => cell.data === '0x');
  console.dir({ emptyCells }, { depth: null });
  const rawTx = ckb.generateRawTransaction({
    fromAddress: ADDRESS,
    toAddress: ADDRESS,
    capacity: (contractBinLength + 100n) * 10n ** 8n,
    fee: 100000n,
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
  // create bridge cell
  const bridgeCellCapacity = 100n * 10n ** 8n;
  const bridgeCellLockscript: CKBComponents.Script = {
    codeHash: lockscriptCodeHash,
    hashType: 'data',
    args: BRIDGE_CELL_LOCKSCRIPT_ARGS,
  };
  const bridgeCellLockscriptHash = ckb.utils.scriptToHash(bridgeCellLockscript);
  nconf.set('bridgeCellLockscript', bridgeCellLockscript);
  nconf.set('bridgeCellLockscriptHash', bridgeCellLockscriptHash);
  rawTx.outputs.push({
    lock: bridgeCellLockscript,
    capacity: `0x${bridgeCellCapacity.toString(16)}`,
  });
  rawTx.outputsData.push('0x');
  // modify change cell
  const changeCellCap = BigInt(rawTx.outputs[1].capacity) - sudtCodeCellCapacity - bridgeCellCapacity;
  rawTx.outputs[1].capacity = `0x${changeCellCap.toString(16)}`;
  console.dir({ rawTx }, { depth: null });

  // return
  const signedTx = ckb.signTransaction(PRI_KEY)(rawTx);
  const deployTxHash = await ckb.rpc.sendTransaction(signedTx);
  console.log(`Transaction has been sent with tx hash ${deployTxHash}`);
  // const txStatus = await waitUntilCommitted(deployTxHash);
  // console.dir({ txStatus }, {depth: null})
  nconf.set('deployTxHash', deployTxHash);
  const scriptsInfo = {
    lockscript: {
      codeHash: lockscriptCodeHash,
      outPoint: {
        txHash: deployTxHash,
        index: '0x0',
      },
    },
    sudt: {
      codeHash: sudtCodeHash,
      outPoint: {
        txHash: deployTxHash,
        index: '0x2',
      },
    },
  };
  nconf.set('scriptsInfo', scriptsInfo);
};

function blake2b(buffer): Uint8Array {
  return utils.blake2b(32, null, null, utils.PERSONAL).update(buffer).digest('binary') as Uint8Array;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

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

/*

mint tx

- cellDeps
    - sudt
    - single-sig
- inputs
    - capacity supply cell
    - bridge cell
        - lock
            - args: ARGS
            - code_hash: lockscriptCodeHash
            - hash_type: data
- outputs
    - sudt cell
        - lock
            - user_lockscript
        - type
            - args: bridgeCellLockscriptHash
            - code_hash: sudtCodeHash
            - hash_type: 'type'
- outputsData
    - amount
- witness

*/
const mint = async () => {
  // get user cells
  const userLockscript = nconf.get('userLockscript');
  const userCells = (await ckb.loadCells({ indexer, CellCollector, lock: userLockscript })).filter(
    (cell) => cell.data === '0x',
  );
  const userLockscriptInOutput = {
    codeHash: userLockscript.codeHash,
    hashType: userLockscript.hashType,
    args: userLockscript.args,
  };
  console.dir({ userCells }, { depth: null });

  const bridgeCellLockscript = nconf.get('bridgeCellLockscript');
  const bridgeCells = (await ckb.loadCells({ indexer, CellCollector, lock: bridgeCellLockscript })).filter(
    (cell) => cell.data === '0x',
  );
  console.dir({ bridgeCells }, { depth: null });

  // compose tx
  const inputCells = userCells.concat(bridgeCells[0]);
  const inputs = inputCells.map((cell) => {
    return { previousOutput: cell.outPoint, since: '0x0' };
  });
  const inputCap = inputCells.map((cell) => BigInt(cell.capacity)).reduce((a, b) => a + b);
  console.dir({ inputs, inputCap }, { depth: null });
  const { secp256k1Dep } = await ckb.loadDeps();
  console.dir({ secp256k1Dep }, { depth: null });
  asserts(secp256k1Dep);
  const sudtCellCapacity = 300n * 10n ** 8n;
  const bridgeCellCapacity = 100n * 10n ** 8n;
  const fee = 100000n;
  const changeCellCapacity = inputCap - bridgeCellCapacity - sudtCellCapacity - fee;
  const rawTx = {
    version: '0x0',
    cellDeps: [
      // secp256k1Dep
      {
        outPoint: secp256k1Dep.outPoint,
        depType: secp256k1Dep.depType,
      },
      // sudt dep
      {
        outPoint: nconf.get('scriptsInfo:sudt:outPoint'),
        depType: 'code',
      },
      // bridge lockscript dep
      {
        outPoint: nconf.get('scriptsInfo:lockscript:outPoint'),
        depType: 'code',
      },
    ],
    headerDeps: [],
    inputs,
    outputs: [
      // sudt cell
      {
        lock: userLockscriptInOutput,
        type: {
          codeHash: nconf.get('scriptsInfo:sudt:codeHash'),
          hashType: 'data',
          args: nconf.get('bridgeCellLockscriptHash'),
        },
        capacity: `0x${sudtCellCapacity.toString(16)}`,
      },
      // create one more bridge cell
      {
        lock: {
          codeHash: `${bridgeCellLockscript.codeHash}`,
          hashType: `${bridgeCellLockscript.hashType}`,
          args: `${bridgeCellLockscript.args}`,
        },
        capacity: `0x${bridgeCellCapacity.toString(16)}`,
      },
      // change cell
      {
        lock: userLockscriptInOutput,
        capacity: `0x${changeCellCapacity.toString(16)}`,
      },
    ],
    witnesses: [{ lock: '', inputType: '', outputType: '' }],
    outputsData: [bigintToSudtAmount(100), '0x', '0x'],
  };
  const signedTx = ckb.signTransaction(PRI_KEY)(rawTx as unknown as CKBComponents.RawTransaction);
  console.dir({ signedTx }, { depth: null });
  const mintTxHash = await ckb.rpc.sendTransaction(signedTx);
  console.log(`Mint Transaction has been sent with tx hash ${mintTxHash}`);
  const mintTxStatus = await waitUntilCommitted(mintTxHash);
  return { mintTxStatus, mintTxHash };
};

const bigintToSudtAmount = (n) => {
  return `0x${Buffer.from(n.toString(16).padStart(32, '0'), 'hex').reverse().toString('hex')}`;
};

const burn = async (sudtCell) => {
  const userLockscript = nconf.get('userLockscript');
  const userLockscriptInOutput = {
    codeHash: userLockscript.codeHash,
    hashType: userLockscript.hashType,
    args: userLockscript.args,
  };
  const { secp256k1Dep } = await ckb.loadDeps();
  console.dir({ secp256k1Dep }, { depth: null });
  asserts(secp256k1Dep);

  const fee = 100000n;
  const sudtCellCapacity = (300n * 10n ** 8n - fee) / 2n;
  const rawTx = {
    version: '0x0',
    cellDeps: [
      // secp256k1Dep
      {
        outPoint: secp256k1Dep.outPoint,
        depType: secp256k1Dep.depType,
      },
      // sudt dep
      {
        outPoint: nconf.get('scriptsInfo:sudt:outPoint'),
        depType: 'code',
      },
    ],
    headerDeps: [],
    inputs: [
      {
        previousOutput: { ...sudtCell.outPoint, index: '0x0' },
        since: '0x0',
      },
    ],
    outputs: [
      // sudt cell
      {
        lock: userLockscriptInOutput,
        type: {
          codeHash: nconf.get('scriptsInfo:sudt:codeHash'),
          hashType: 'data',
          args: nconf.get('bridgeCellLockscriptHash'),
        },
        capacity: `0x${sudtCellCapacity.toString(16)}`,
      },
      // sudt change cell
      {
        lock: userLockscriptInOutput,
        type: {
          codeHash: nconf.get('scriptsInfo:sudt:codeHash'),
          hashType: 'data',
          args: nconf.get('bridgeCellLockscriptHash'),
        },
        capacity: `0x${sudtCellCapacity.toString(16)}`,
      },
    ],
    witnesses: [{ lock: '', inputType: '', outputType: '' }],
    outputsData: [bigintToSudtAmount(99), bigintToSudtAmount(1)],
  };
  console.dir({ rawTx }, { depth: null });
  const signedTx = ckb.signTransaction(PRI_KEY)(rawTx as unknown as CKBComponents.RawTransaction);
  console.dir({ signedTx }, { depth: null });
  const burnTxHash = await ckb.rpc.sendTransaction(signedTx);
  console.log(`Burn Transaction has been sent with tx hash ${burnTxHash}`);
  const burnTxStatus = await waitUntilCommitted(burnTxHash);
  return { burnTxStatus, burnTxHash };
};

const bootstrap = async () => {
  console.log('\n\n\n---------start-----------\n');
  // loadconfig
  nconf.env().file({ file: configPath });
  await deploy();
  await sleep(3000);
  await indexer.waitForSync();
  const { mintTxStatus, mintTxHash } = await mint();
  console.dir({ mintTxStatus }, { depth: null });
  const sudtCell = mintTxStatus.transaction.outputs[0];
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  sudtCell.outPoint = {
    txHash: mintTxHash,
    index: 0x0,
  };
  await burn(sudtCell);
  nconf.save();
};

bootstrap();
