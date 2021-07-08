import { Cell, Script as LumosScript, Indexer, WitnessArgs, core } from '@ckb-lumos/base';
import { common } from '@ckb-lumos/common-scripts';
import { TransactionSkeleton, TransactionSkeletonType } from '@ckb-lumos/helpers';
import { Address, Amount, DepType, Script, HashType } from '@lay2/pw-core';
import CKB from '@nervosnetwork/ckb-sdk-core';
import { Reader, normalizers } from 'ckb-js-toolkit';
import { ForceBridgeCore } from '../../core';
import { asserts } from '../../errors';
import { asyncSleep, fromHexString, stringToUint8Array, toHexString } from '../../utils';
import { logger } from '../../utils/logger';
import { Asset } from '../model/asset';
import { IndexerCollector } from './collector';
import { SerializeRecipientCellData } from './generated/eth_recipient_cell';
import { SerializeMintWitness } from './generated/mint_witness';
import { CkbIndexer, ScriptType, IndexerCell } from './indexer';
import { getFromAddr, getOwnerTypeHash } from './multisig/multisig_helper';

interface OutPutCell {
  lock: {
    codeHash: string;
    hashType: HashType;
    args: string;
  };
  type?: {
    codeHash: string;
    hashType: HashType;
    args: string;
  };
  capacity: string;
}

export interface MintAssetRecord {
  lockTxHash: string;
  asset: Asset;
  amount: Amount;
  recipient: Address;
}

export class CkbTxGenerator {
  private collector: IndexerCollector;

  constructor(private ckb: CKB, private ckbIndexer: CkbIndexer) {
    this.collector = new IndexerCollector(ckbIndexer);
  }

  sudtDep = {
    out_point: {
      tx_hash: ForceBridgeCore.config.ckb.deps.sudtType.cellDep.outPoint.txHash,
      index: ForceBridgeCore.config.ckb.deps.sudtType.cellDep.outPoint.index,
    },
    dep_type: ForceBridgeCore.config.ckb.deps.sudtType.cellDep.depType,
  };

  bridgeLockDep = {
    out_point: {
      tx_hash: ForceBridgeCore.config.ckb.deps.bridgeLock.cellDep.outPoint.txHash,
      index: ForceBridgeCore.config.ckb.deps.bridgeLock.cellDep.outPoint.index,
    },
    dep_type: ForceBridgeCore.config.ckb.deps.bridgeLock.cellDep.depType,
  };

  async fetchOwnerCell(): Promise<Cell | undefined> {
    const cellCollector = this.ckbIndexer.collector({
      type: ForceBridgeCore.config.ckb.ownerCellTypescript,
    });
    for await (const cell of cellCollector.collect()) {
      return cell;
    }
  }

  // fixme: if not find multisig cell, create it
  async fetchMultisigCell(): Promise<Cell | undefined> {
    const cellCollector = this.ckbIndexer.collector({
      lock: ForceBridgeCore.config.ckb.multisigLockscript,
    });
    for await (const cell of cellCollector.collect()) {
      if (cell.cell_output.type === null) {
        return cell;
      }
    }
  }

  async fetchBridgeCell(bridgeLock: LumosScript, indexer: Indexer, maxTimes: number): Promise<Cell> {
    const cellCollector = this.ckbIndexer.collector({
      lock: bridgeLock,
    });
    let index = 0;
    while (true) {
      if (index > maxTimes) {
        throw new Error('failed to fetch bridge cell.');
      }
      for await (const cell of cellCollector.collect()) {
        if (cell != undefined) {
          return cell;
        }
      }
      logger.debug('try to fetch bridge cell: ', index++);
      await asyncSleep(1000);
    }
  }

  async createBridgeCell(scripts: Script[], indexer: Indexer): Promise<TransactionSkeletonType> {
    for (;;) {
      try {
        const fromAddress = getFromAddr();
        let txSkeleton = TransactionSkeleton({ cellProvider: indexer });
        const multisig_cell = await this.fetchMultisigCell();
        txSkeleton = await common.setupInputCell(txSkeleton, multisig_cell!, ForceBridgeCore.config.ckb.multisigScript);
        const bridgeCellCapacity = 200n * 10n ** 8n;
        const bridgeOutputs = scripts.map((script) => {
          return <Cell>{
            cell_output: {
              capacity: `0x${bridgeCellCapacity.toString(16)}`,
              lock: {
                code_hash: script.codeHash,
                hash_type: script.hashType,
                args: script.args,
              },
            },
            data: '0x',
          };
        });
        logger.debug('bridgeOutputs:', JSON.stringify(bridgeOutputs, null, 2));
        txSkeleton = txSkeleton.update('outputs', (outputs) => {
          return outputs.push(...bridgeOutputs);
        });
        //TODO fix fee calculate
        const needCapacity = bridgeCellCapacity * BigInt(scripts.length) + bridgeCellCapacity;
        if (needCapacity !== 0n) {
          txSkeleton = await common.injectCapacity(txSkeleton, [fromAddress], needCapacity);
        }
        const feeRate = BigInt(1000);
        txSkeleton = await common.payFeeByFeeRate(txSkeleton, [fromAddress], feeRate);
        txSkeleton = common.prepareSigningEntries(txSkeleton);
        return txSkeleton;
      } catch (e) {
        logger.error(`CkbHandler createBridgeCell exception error:${e.message}, stack: ${e.stack}`);
        await asyncSleep(3000);
      }
    }
  }

  async mint(records: MintAssetRecord[], indexer: Indexer): Promise<TransactionSkeletonType> {
    for (;;) {
      try {
        const fromAddress = getFromAddr();
        let txSkeleton = TransactionSkeleton({ cellProvider: indexer });
        const multisigCell = await this.fetchMultisigCell();
        if (multisigCell === undefined) {
          logger.error(`CkbHandler mint fetchMultiSigCell failed: cannot found multiSig cell`);
          await asyncSleep(3000);
          continue;
        }
        txSkeleton = await common.setupInputCell(txSkeleton, multisigCell, ForceBridgeCore.config.ckb.multisigScript);
        txSkeleton = txSkeleton.update('cellDeps', (cellDeps) => {
          return cellDeps.push(this.sudtDep);
        });
        txSkeleton = txSkeleton.update('cellDeps', (cellDeps) => {
          return cellDeps.push(this.bridgeLockDep);
        });
        // add owner cell as cell dep
        const ownerCell = await this.fetchOwnerCell();
        if (ownerCell === undefined) {
          logger.error(`CkbHandler mint fetchMultiSigCell failed: cannot found owner cell`);
          await asyncSleep(3000);
          continue;
        }
        txSkeleton = txSkeleton.update('cellDeps', (cellDeps) => {
          return cellDeps.push({
            out_point: ownerCell.out_point!,
            dep_type: DepType.code,
          });
        });

        const mintWitness = this.getMintWitness(records);
        const mintWitnessArgs = core.SerializeWitnessArgs({ lock: null, input_type: mintWitness, output_type: null });
        txSkeleton = txSkeleton.update('witnesses', (witnesses) => {
          if (witnesses.isEmpty()) {
            return witnesses.push(`0x${toHexString(new Uint8Array(mintWitnessArgs))}`);
          }
          const witnessArgs = new core.WitnessArgs(new Reader(witnesses.get(0) as string));
          const newWitnessArgs: WitnessArgs = {
            input_type: `0x${toHexString(new Uint8Array(mintWitness))}`,
          };
          if (witnessArgs.getLock().hasValue()) {
            newWitnessArgs.lock = new Reader(witnessArgs.getLock().value().raw()).serializeJson();
          }
          if (witnessArgs.getOutputType().hasValue()) {
            newWitnessArgs.output_type = new Reader(witnessArgs.getOutputType().value().raw()).serializeJson();
          }
          return witnesses.set(
            0,
            new Reader(core.SerializeWitnessArgs(normalizers.NormalizeWitnessArgs(newWitnessArgs))).serializeJson(),
          );
        });

        txSkeleton = await this.buildSudtOutput(txSkeleton, records);
        txSkeleton = await this.buildBridgeCellOutput(txSkeleton, records, indexer);

        const feeRate = BigInt(1000);
        txSkeleton = await common.payFeeByFeeRate(txSkeleton, [fromAddress], feeRate);
        txSkeleton = common.prepareSigningEntries(txSkeleton);
        return txSkeleton;
      } catch (e) {
        logger.error(`CkbHandler mint exception error:${e.message}`);
        await asyncSleep(3000);
      }
    }
  }

  getMintWitness(records: MintAssetRecord[]): ArrayBuffer {
    const lockTxHashes = new Array(0);
    records.forEach((record) => {
      const lockTxHash = fromHexString(toHexString(stringToUint8Array(record.lockTxHash))).buffer;
      lockTxHashes.push(lockTxHash);
    });
    return SerializeMintWitness({ lock_tx_hashes: lockTxHashes });
  }

  async buildSudtOutput(
    txSkeleton: TransactionSkeletonType,
    records: MintAssetRecord[],
  ): Promise<TransactionSkeletonType> {
    const fromAddress = getFromAddr();
    const sudtCellCapacity = 300n * 10n ** 8n;
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
      const outputSudtCell = <Cell>{
        cell_output: {
          capacity: `0x${sudtCellCapacity.toString(16)}`,
          lock: {
            code_hash: recipientLockscript.codeHash,
            hash_type: recipientLockscript.hashType,
            args: recipientLockscript.args,
          },
          type: {
            code_hash: ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash,
            hash_type: ForceBridgeCore.config.ckb.deps.sudtType.script.hashType,
            args: sudtArgs,
          },
        },
        data: record.amount.toUInt128LE(),
      };
      txSkeleton = txSkeleton.update('outputs', (outputs) => {
        return outputs.push(outputSudtCell);
      });
    }
    for (let i = 1; i <= records.length; i++) {
      txSkeleton = txSkeleton.update('fixedEntries', (fixedEntries) => {
        return fixedEntries.push({
          field: 'outputs',
          index: i,
        });
      });
    }
    //TODO fix fee calculate
    const needCapacity = sudtCellCapacity * BigInt(records.length) + sudtCellCapacity;
    if (needCapacity !== 0n) {
      txSkeleton = await common.injectCapacity(txSkeleton, [fromAddress], needCapacity);
    }
    return txSkeleton;
  }

  async buildBridgeCellOutput(
    txSkeleton: TransactionSkeletonType,
    records: MintAssetRecord[],
    indexer: Indexer,
  ): Promise<TransactionSkeletonType> {
    const assets = new Array(0);
    for (const record of records) {
      const bridgeCellLockscript = {
        codeHash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
        hashType: ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
        args: record.asset.toBridgeLockscriptArgs(),
      };
      if (assets.indexOf(record.asset.toBridgeLockscriptArgs()) != -1) {
        continue;
      }
      assets.push(record.asset.toBridgeLockscriptArgs());
      const bridge_cell = await this.fetchBridgeCell(
        {
          code_hash: bridgeCellLockscript.codeHash,
          hash_type: bridgeCellLockscript.hashType,
          args: bridgeCellLockscript.args,
        },
        indexer,
        5,
      );
      txSkeleton = txSkeleton.update('inputs', (inputs) => {
        return inputs.push(bridge_cell);
      });
      const outputBridgeCell = <Cell>{
        cell_output: {
          capacity: bridge_cell.cell_output.capacity,
          lock: bridge_cell.cell_output.lock,
          type: bridge_cell.cell_output.type,
        },
        data: '0x',
      };
      txSkeleton = txSkeleton.update('outputs', (outputs) => {
        return outputs.push(outputBridgeCell);
      });
    }
    return txSkeleton;
  }

  /*
  table RecipientCellData {
    recipient_address: Bytes,
    chain: byte,
    asset: Bytes,
    bridge_lock_code_hash: Byte32,
    owner_lock_hash: Byte32,
    amount: Uint128,
  }
   */
  async burn(
    fromLockscript: Script,
    recipientAddress: string,
    asset: Asset,
    amount: Amount,
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
      script: fromLockscript.serializeJson() as LumosScript,
      script_type: ScriptType.lock,
      filter: {
        script: new Script(
          ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash,
          args,
          ForceBridgeCore.config.ckb.deps.sudtType.script.hashType,
        ).serializeJson() as LumosScript,
      },
    };
    const sudtCells = await this.collector.collectSudtByAmount(searchKey, amount);
    if (sudtCells.length == 0) {
      throw new Error('failed to generate burn tx. the live sudt cell is not found!');
    }
    logger.debug('burn sudtCells: ', sudtCells);
    let inputCells = sudtCells;
    const ownerCellTypeHash = getOwnerTypeHash();

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
      owner_cell_type_hash: fromHexString(ownerCellTypeHash).buffer,
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
      const needSupplyCapCells = await this.collector.getCellsByLockscriptAndCapacityWhenBurn(
        fromLockscript,
        recipientTypeScript.codeHash,
        new Amount(`0x${needSupplyCap.toString(16)}`, 0),
      );
      const suppliedCap = needSupplyCapCells.map((cell) => BigInt(cell.capacity)).reduce((a, b) => a + b);
      if (suppliedCap - needSupplyCap < 0) {
        throw new Error('need supply amount is not enough!');
      }
      inputCells = inputCells.concat(needSupplyCapCells);
    }

    this.handleChangeCell(inputCells, outputs, outputsData, fromLockscript, fee);

    const inputs = inputCells.map((cell) => {
      return { previousOutput: cell.outPoint, since: '0x0' };
    });

    const { secp256k1Dep } = await this.ckb.loadDeps();

    asserts(secp256k1Dep);

    const cellDeps = [
      {
        outPoint: ForceBridgeCore.secp256k1Dep.outPoint,
        depType: ForceBridgeCore.secp256k1Dep.depType,
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

  handleChangeCell(
    inputCells: IndexerCell[],
    outputs: Array<OutPutCell>,
    outputsData: Array<string>,
    userLockscript: Script,
    fee: bigint,
  ): void {
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
}
