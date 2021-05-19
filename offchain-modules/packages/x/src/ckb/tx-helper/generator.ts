import { Script as LumosScript } from '@ckb-lumos/base';
import { Address, Amount, Script } from '@lay2/pw-core';
import CKB from '@nervosnetwork/ckb-sdk-core';
import { IndexerCollector } from '../../ckb/tx-helper/collector';
import { SerializeRecipientCellData } from '../../ckb/tx-helper/generated/eth_recipient_cell';
import { ScriptType } from '../../ckb/tx-helper/indexer';
import { ForceBridgeCore } from '../../core';
import { bigintToSudtAmount, fromHexString, stringToUint8Array, toHexString } from '../../utils';
import { logger } from '../../utils/logger';
import { Asset } from '../model/asset';

export interface MintAssetRecord {
  asset: Asset;
  amount: Amount;
  recipient: Address;
}

export class CkbTxGenerator {
  constructor(private ckb: CKB, private collector: IndexerCollector) {}

  async createBridgeCell(
    fromLockscript: Script,
    bridgeLockscripts: any[],
  ): Promise<CKBComponents.RawTransactionToSign> {
    logger.debug('createBredgeCell:', bridgeLockscripts);
    const bridgeCellCapacity = 200n * 10n ** 8n;
    const outputsData = [];
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
    const needSupplyCap = bridgeCellCapacity * BigInt(bridgeLockscripts.length) + fee;
    const supplyCapCells = await this.collector.getCellsByLockscriptAndCapacity(
      fromLockscript,
      new Amount(`0x${needSupplyCap.toString(16)}`, 0),
    );
    const inputs = supplyCapCells.map((cell) => {
      return { previousOutput: cell.outPoint, since: '0x0' };
    });
    this.handleChangeCell(supplyCapCells, outputs, outputsData, fromLockscript, fee);
    const { secp256k1Dep } = await this.ckb.loadDeps();
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
    logger.debug('createBridgeCell rawTx:', rawTx);
    return rawTx as CKBComponents.RawTransactionToSign;
  }

  async mint(userLockscript: Script, records: MintAssetRecord[]): Promise<CKBComponents.RawTransactionToSign> {
    logger.debug('start to mint records: ', records);
    const bridgeCells = new Array(0);
    const outputs = new Array(0);
    const outputsData = new Array(0);
    const sudtCellCapacity = 300n * 10n ** 8n;
    const assets = new Array(0);
    for (const record of records) {
      if (record.amount.eq(Amount.ZERO)) {
        continue;
      }
      const recipientLockscript = record.recipient.toLockScript();
      const bridgeCellLockscript = {
        codeHash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
        hashType: ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
        args: record.asset.toBridgeLockscriptArgs(),
      };

      const sudtArgs = this.ckb.utils.scriptToHash(<CKBComponents.Script>bridgeCellLockscript);
      const outputSudtCell = {
        lock: recipientLockscript,
        type: {
          codeHash: ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash,
          hashType: ForceBridgeCore.config.ckb.deps.sudtType.script.hashType,
          args: sudtArgs,
        },
        capacity: `0x${sudtCellCapacity.toString(16)}`,
      };
      outputs.push(outputSudtCell);
      outputsData.push(record.amount.toUInt128LE());

      if (assets.indexOf(record.asset.toBridgeLockscriptArgs()) != -1) {
        continue;
      }
      assets.push(record.asset.toBridgeLockscriptArgs());

      const searchKey = {
        script: new Script(
          bridgeCellLockscript.codeHash,
          bridgeCellLockscript.args,
          bridgeCellLockscript.hashType,
        ).serializeJson() as LumosScript,
        script_type: ScriptType.lock,
      };
      const cells = await this.collector.indexer.getCells(searchKey);
      if (cells.length == 0) {
        throw new Error('failed to generate mint tx. the live cell is not found!');
      }
      const bridgeCell = cells[0];
      const outputBridgeCell = {
        lock: bridgeCellLockscript,
        capacity: bridgeCell.capacity,
      };
      outputs.push(outputBridgeCell);
      outputsData.push('0x');
      bridgeCells.push(bridgeCell);
    }

    const fee = 100000n;
    const needSupplyCap = sudtCellCapacity * BigInt(records.length) + fee;
    const supplyCapCells = await this.collector.getCellsByLockscriptAndCapacity(
      userLockscript,
      new Amount(`0x${needSupplyCap.toString(16)}`, 0),
    );
    const inputCells = supplyCapCells.concat(bridgeCells);
    const inputs = inputCells.map((cell) => {
      return { previousOutput: cell.outPoint, since: '0x0' };
    });
    this.handleChangeCell(inputCells, outputs, outputsData, userLockscript, fee);

    const { secp256k1Dep } = await this.ckb.loadDeps();
    const cellDeps = [
      {
        outPoint: secp256k1Dep.outPoint,
        depType: secp256k1Dep.depType,
      },
      // sudt dep
      {
        outPoint: ForceBridgeCore.config.ckb.deps.sudtType.cellDep.outPoint,
        depType: ForceBridgeCore.config.ckb.deps.sudtType.cellDep.depType,
      },
      // bridge lockscript dep
      {
        outPoint: ForceBridgeCore.config.ckb.deps.bridgeLock.cellDep.outPoint,
        depType: ForceBridgeCore.config.ckb.deps.bridgeLock.cellDep.depType,
      },
    ];

    const rawTx = {
      version: '0x0',
      cellDeps,
      headerDeps: [],
      inputs,
      outputs,
      witnesses: [{ lock: '', inputType: '', outputType: '' }],
      outputsData,
    };
    logger.debug('generate mint rawTx:', rawTx);
    return rawTx as CKBComponents.RawTransactionToSign;
  }

  /*
  table RecipientCellData {
    recipient_address: Bytes,
    chain: byte,
    asset: Bytes,
    bridge_lock_code_hash: Byte32,
    owner_lock_hash: Byte32,
    amount: Uint128,
    fee: Uint128,
  }
   */
  async burn(
    fromLockscript: Script,
    recipientAddress: string,
    asset: Asset,
    amount: Amount,
    bridgeFee?: Amount,
  ): Promise<CKBComponents.RawTransactionToSign> {
    if (amount.eq(Amount.ZERO)) {
      throw new Error('amount should larger then zero!');
    }
    const bridgeCellLockscript = {
      codeHash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
      hashType: ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
      args: asset.toBridgeLockscriptArgs(),
    };
    const args = this.ckb.utils.scriptToHash(<CKBComponents.Script>bridgeCellLockscript);
    const searchKey = {
      script: new Script(
        ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash,
        args,
        ForceBridgeCore.config.ckb.deps.sudtType.script.hashType,
      ).serializeJson() as LumosScript,
      script_type: ScriptType.type,
      filter: {
        script: fromLockscript.serializeJson() as LumosScript,
      },
    };
    const sudtCells = await this.collector.collectSudtByAmount(searchKey, amount);
    if (sudtCells.length == 0) {
      throw new Error('failed to generate burn tx. the live sudt cell is not found!');
    }
    logger.debug('burn sudtCells: ', sudtCells);
    let inputCells = sudtCells;
    const ownerLockHash = ForceBridgeCore.config.ckb.ownerLockHash;

    const recipientAddr = fromHexString(toHexString(stringToUint8Array(recipientAddress))).buffer;

    let hashType;
    switch (ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType) {
      case 'data':
        hashType = 0;
        break;
      case 'type':
        hashType = 1;
        break;
      default:
        throw new Error('invalid hash type');
    }

    const params = {
      recipient_address: recipientAddr,
      chain: asset.chainType,
      asset: fromHexString(toHexString(stringToUint8Array(asset.getAddress()))).buffer,
      amount: fromHexString(amount.toUInt128LE()).buffer,
      bridge_lock_code_hash: fromHexString(ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash).buffer,
      bridge_lock_hash_type: hashType,
      owner_lock_hash: fromHexString(ownerLockHash).buffer,
      fee: new Uint8Array(16).buffer,
    };

    const recipientCellData = `0x${toHexString(new Uint8Array(SerializeRecipientCellData(params)))}`;

    const outputs = new Array(0);
    const outputsData = new Array(0);

    const recipientTypeScript = {
      codeHash: ForceBridgeCore.config.ckb.deps.recipientType.script.codeHash,
      hashType: ForceBridgeCore.config.ckb.deps.recipientType.script.hashType,
      args: '0x',
    };
    const recipientCap = (BigInt(recipientCellData.length) + 100n) * 10n ** 8n;
    const recipientOutput = {
      lock: fromLockscript,
      type: recipientTypeScript,
      capacity: `0x${recipientCap.toString(16)}`,
    };
    outputs.push(recipientOutput);
    outputsData.push(recipientCellData);

    const total = sudtCells.map((cell) => Amount.fromUInt128LE(cell.data)).reduce((a, b) => a.add(b));
    let changeAmount = Amount.ZERO;
    const sudtCellCapacity = 300n * 10n ** 8n;
    if (total.gt(amount)) {
      changeAmount = total.sub(amount);
      const changeOutput = {
        lock: sudtCells[0].lock,
        type: sudtCells[0].type,
        capacity: `0x${sudtCellCapacity.toString(16)}`,
      };
      outputs.push(changeOutput);
      outputsData.push(changeAmount.toUInt128LE());
    } else if (total.lt(amount)) {
      throw new Error('sudt amount is not enough!');
    }
    const fee = 100000n;
    const outputCap = outputs.map((cell) => BigInt(cell.capacity)).reduce((a, b) => a + b);

    const needSupplyCap = outputCap - sudtCellCapacity * BigInt(sudtCells.length) + fee;
    if (needSupplyCap > 0) {
      const needSupplyCapCells = await this.collector.getCellsByLockscriptAndCapacity(
        fromLockscript,
        new Amount(`0x${needSupplyCap.toString(16)}`, 0),
      );
      inputCells = inputCells.concat(needSupplyCapCells);
    }

    this.handleChangeCell(inputCells, outputs, outputsData, fromLockscript, fee);

    const inputs = inputCells.map((cell) => {
      return { previousOutput: cell.outPoint, since: '0x0' };
    });

    const { secp256k1Dep } = await this.ckb.loadDeps();
    const cellDeps = [
      {
        outPoint: secp256k1Dep.outPoint,
        depType: secp256k1Dep.depType,
      },
      // sudt dep
      {
        outPoint: ForceBridgeCore.config.ckb.deps.sudtType.cellDep.outPoint,
        depType: ForceBridgeCore.config.ckb.deps.sudtType.cellDep.depType,
      },
      // recipient dep
      {
        outPoint: ForceBridgeCore.config.ckb.deps.recipientType.cellDep.outPoint,
        depType: ForceBridgeCore.config.ckb.deps.recipientType.cellDep.depType,
      },
    ];

    const rawTx = {
      version: '0x0',
      cellDeps,
      headerDeps: [],
      inputs,
      outputs,
      witnesses: [{ lock: '', inputType: '', outputType: '' }],
      outputsData,
    };
    logger.debug('generate burn rawTx:', rawTx);
    return rawTx as CKBComponents.RawTransactionToSign;
  }

  handleChangeCell(inputCells, outputs, outputsData, userLockscript, fee): void {
    const inputCap = inputCells.map((cell) => BigInt(cell.capacity)).reduce((a, b) => a + b);
    const outputCap = outputs.map((cell) => BigInt(cell.capacity)).reduce((a, b) => a + b);
    const changeCellCapacity = inputCap - outputCap - fee;
    logger.debug('inputCap: ', inputCap, ' outputCap: ', outputCap, ' fee:', fee);
    //FIXME: if changeCellCapacity < 64 * 10n ** 8n
    if (changeCellCapacity > 64n * 10n ** 8n) {
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
    }
  }

  async supplyCap(lockscript, inputsCell, outputs, outputsData, fee) {
    let inputCap = inputsCell.map((cell) => BigInt(cell.capacity)).reduce((a, b) => a + b);
    const outputCap = outputs.map((cell) => BigInt(cell.capacity)).reduce((a, b) => a + b);
    const needSupplyCapCells = await this.collector.getCellsByLockscriptAndCapacity(
      lockscript,
      Amount.fromUInt128LE(bigintToSudtAmount(outputCap - inputCap + fee)),
    );
    inputsCell = inputsCell.concat(needSupplyCapCells);
    inputCap = inputsCell.map((cell) => BigInt(cell.capacity)).reduce((a, b) => a + b);
    const changeCellCapacity = inputCap - outputCap - fee;
    if (changeCellCapacity > 64n * 10n ** 8n) {
      const changeLockScript = {
        codeHash: lockscript.codeHash,
        hashType: lockscript.hashType,
        args: lockscript.args,
      };
      const changeCell = {
        lock: changeLockScript,
        capacity: `0x${changeCellCapacity.toString(16)}`,
      };
      outputs.push(changeCell);
      outputsData.push('0x');
    }
    return {
      inputsCell: inputsCell,
      outputs: outputs,
      outputsData: outputsData,
    };
  }
}
