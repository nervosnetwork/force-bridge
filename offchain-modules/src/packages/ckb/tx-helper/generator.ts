import { Address, Transaction, Amount, Script, Cell, AddressType, AddressPrefix } from '@lay2/pw-core';
import { Script as LumosScript } from '@ckb-lumos/base';
import { Asset, ChainType } from '../model/asset';
import { logger } from '@force-bridge/utils/logger';
import { ScriptType } from '@force-bridge/ckb/tx-helper/indexer';
import { ForceBridgeCore } from '@force-bridge/core';
// import assert from 'assert';
// import { blake2b } from '@force-bridge/utils';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nconf = require('nconf');

// const CKB = require('@nervosnetwork/ckb-sdk-core').default;
const PRI_KEY = process.env.PRI_KEY || '0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe';
// const PUB_KEY = ckb.utils.privateKeyToPublicKey(PRI_KEY);
// const ARGS = `0x${ckb.utils.blake160(PUB_KEY, 'hex')}`;
// const ADDRESS = ckb.utils.pubkeyToAddress(PUB_KEY);

export interface MintAssetRecord {
  asset: Asset;
  amount: Amount;
  recipient: Address;
}

export class CkbTxGenerator {
  private ckb = ForceBridgeCore.ckb;
  private indexer = ForceBridgeCore.indexer;

  async deploy(fromLockscript: Script, binaries: Buffer[]): Promise<Transaction> {
    throw new Error('not implemented');
  }

  async createBridgeCell(
    fromLockscript: Script,
    bridgeLockscripts: any[],
  ): Promise<CKBComponents.RawTransactionToSign> {
    logger.debug('createBredgeCell:', bridgeLockscripts);
    const bridgeCellCapacity = 100n * 10n ** 8n;
    const searchKey = {
      script: fromLockscript.serializeJson() as LumosScript,
      script_type: ScriptType.lock,
    };
    const { secp256k1Dep } = await this.ckb.loadDeps();
    const userCells = await this.indexer.getCells(searchKey);
    let uCells = new Array(0);
    uCells = uCells.concat(userCells);
    const emptyCells = uCells.filter((cell) => cell.output_data === '0x');
    const inputs = emptyCells.map((cell) => {
      return { previousOutput: { txHash: cell.out_point.tx_hash, index: cell.out_point.index }, since: '0x0' };
    });
    const outputsData = ['0x'];
    const outputBridgeCells = bridgeLockscripts.map((s) => {
      outputsData.push('0x');
      return {
        lock: s,
        capacity: `0x${bridgeCellCapacity.toString(16)}`,
      };
    });
    let outputs = new Array(0);
    outputs = outputs.concat(outputBridgeCells);
    const fee = 100000n;
    const userCap = emptyCells.map((cell) => BigInt(cell.output.capacity)).reduce((a, b) => a + b);
    const changeCellCapacity = userCap - bridgeCellCapacity * BigInt(bridgeLockscripts.length) - fee;
    const changeLockScript = {
      codeHash: fromLockscript.codeHash,
      hashType: fromLockscript.hashType,
      args: fromLockscript.args,
    };
    const changeCell = {
      lock: changeLockScript,
      capacity: `0x${changeCellCapacity.toString(16)}`,
    };
    outputs.push(changeCell);

    const rawTx = {
      version: '0x0',
      cellDeps: [
        {
          outPoint: secp256k1Dep.outPoint,
          depType: secp256k1Dep.depType,
        },
      ],
      headerDeps: [],
      inputs,
      outputs,
      witnesses: [{ lock: '', inputType: '', outputType: '' }],
      outputsData,
    };
    console.dir({ rawTx }, { depth: null });
    return rawTx;
  }

  async mint(userLockscript: Script, records: MintAssetRecord[]): Promise<CKBComponents.RawTransactionToSign> {
    logger.debug('start to mint records: ', records.length);

    let searchKey = {
      script: userLockscript.serializeJson() as LumosScript,
      script_type: ScriptType.lock,
    };
    const userCells = await this.indexer.getCells(searchKey);

    let uCells = new Array(0);
    uCells = uCells.concat(userCells).filter((cell) => cell.output_data === '0x');
    let bridgeCells = new Array(0);
    let bridgeCellLockscript;
    const outputs = new Array(0);
    const outputsData = new Array(0);
    const sudtCellCapacity = 300n * 10n ** 8n;
    for (const record of records) {
      const recipient_lockscript = record.recipient.toLockScript();
      bridgeCellLockscript = {
        codeHash: nconf.get('bridgeCellLockscript:codeHash'),
        hashType: 'data',
        args: '0x0102',
      };
      searchKey = {
        script: new Script(
          bridgeCellLockscript.codeHash,
          bridgeCellLockscript.args,
          bridgeCellLockscript.hashType,
        ).serializeJson() as LumosScript,
        script_type: ScriptType.lock,
      };
      logger.debug('start to mint: bridgeCellLockscript ', bridgeCellLockscript);
      bridgeCells = await this.indexer.getCells(searchKey);
      const bridgeCellOutput = bridgeCells[0].output;
      const outputSudtCell = {
        lock: recipient_lockscript,
        type: {
          codeHash: nconf.get('forceBridge:ckb:deps:sudt:script:codeHash'),
          hashType: 'data',
          args: nconf.get('bridgeCellLockscriptHash'),
        },
        capacity: `0x${sudtCellCapacity.toString(16)}`,
      };
      const outputBridgeCell = {
        lock: bridgeCellLockscript,
        capacity: bridgeCellOutput.capacity,
      };
      outputs.push(outputSudtCell);
      outputsData.push(bigintToSudtAmount(record.amount.toBigInt()));
      outputs.push(outputBridgeCell);
      outputsData.push('0x');
    }
    const inputCells = uCells.concat(bridgeCells);
    const inputs = inputCells.map((cell) => {
      return { previousOutput: { txHash: cell.out_point.tx_hash, index: cell.out_point.index }, since: '0x0' };
    });
    const userCap = uCells.map((cell) => BigInt(cell.output.capacity)).reduce((a, b) => a + b);
    console.dir({ inputs, userCap }, { depth: null });
    const { secp256k1Dep } = await this.ckb.loadDeps();
    console.dir({ secp256k1Dep }, { depth: null });
    const fee = 100000n;
    const changeCellCapacity = userCap - sudtCellCapacity * BigInt(records.length) - fee;
    const changeLockScript = {
      codeHash: userLockscript.codeHash,
      hashType: userLockscript.hashType,
      args: userLockscript.args,
    };
    const changeCell = {
      lock: changeLockScript,
      capacity: `0x${changeCellCapacity.toString(16)}`,
    };
    outputs.push(changeCell);
    outputsData.push('0x');
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
          outPoint: nconf.get('forceBridge:ckb:deps:sudt:cellDep:outPoint'),
          depType: 'code',
        },
        // bridge lockscript dep
        {
          outPoint: nconf.get('forceBridge:ckb:deps:bridgeLock:cellDep:outPoint'),
          depType: 'code',
        },
      ],
      headerDeps: [],
      inputs,
      outputs,
      witnesses: [{ lock: '', inputType: '', outputType: '' }],
      outputsData,
    };
    console.dir({ rawTx }, { depth: null });
    return rawTx;
  }

  async burn(fromLockscript: Script, sudtToken: string, amount: Amount, bridgeFee?: Amount): Promise<Transaction> {
    throw new Error('not implemented');
  }
}

const bigintToSudtAmount = (n) => {
  return `0x${Buffer.from(n.toString(16).padStart(32, '0'), 'hex').reverse().toString('hex')}`;
};
