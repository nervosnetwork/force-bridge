import { Cell, Script, utils, WitnessArgs as IWitnessArgs } from '@ckb-lumos/base';
import { WitnessArgs, RawTransaction } from '@ckb-lumos/base/lib/blockchain';
import { ScriptType } from '@ckb-lumos/ckb-indexer/src/type';
import { bytes } from '@ckb-lumos/codec';
import { common } from '@ckb-lumos/common-scripts';
import {
  minimalCellCapacity,
  parseAddress,
  TransactionSkeleton,
  TransactionSkeletonType,
  createTransactionFromSkeleton,
} from '@ckb-lumos/helpers';
import { Reader } from 'ckb-js-toolkit';
import * as lodash from 'lodash';
import { ForceBridgeCore } from '../../core';
import { asserts } from '../../errors';
import { asyncSleep, fromHexString, stringToUint8Array, toHexString, transactionSkeletonToJSON } from '../../utils';
import { logger } from '../../utils/logger';
import { Asset } from '../model/asset';
import { CkbTxHelper } from './base_generator';
import { SerializeRecipientCellData } from './generated/eth_recipient_cell';
import { SerializeMintWitness } from './generated/mint_witness';
import { SerializeRcLockWitnessLock } from './generated/omni_lock';
import { getFromAddr, getMultisigLock, getOwnerTypeHash } from './multisig/multisig_helper';

export interface MintAssetRecord {
  id: string;
  asset: Asset;
  amount: bigint;
  recipient: string;
  sudtExtraData: string;
}

export class CkbTxGenerator extends CkbTxHelper {
  sudtDep = {
    outPoint: {
      txHash: ForceBridgeCore.config.ckb.deps.sudtType.cellDep.outPoint.txHash,
      index: ForceBridgeCore.config.ckb.deps.sudtType.cellDep.outPoint.index,
    },
    depType: ForceBridgeCore.config.ckb.deps.sudtType.cellDep.depType,
  };

  recipientDep = {
    outPoint: {
      txHash: ForceBridgeCore.config.ckb.deps.recipientType.cellDep.outPoint.txHash,
      index: ForceBridgeCore.config.ckb.deps.recipientType.cellDep.outPoint.index,
    },
    depType: ForceBridgeCore.config.ckb.deps.recipientType.cellDep.depType,
  };

  bridgeLockDep = {
    outPoint: {
      txHash: ForceBridgeCore.config.ckb.deps.bridgeLock.cellDep.outPoint.txHash,
      index: ForceBridgeCore.config.ckb.deps.bridgeLock.cellDep.outPoint.index,
    },
    depType: ForceBridgeCore.config.ckb.deps.bridgeLock.cellDep.depType,
  };

  constructor(ckbRpcUrl: string, ckbIndexerUrl: string) {
    super(ckbRpcUrl, ckbIndexerUrl);
  }

  async fetchOwnerCell(): Promise<Cell | undefined> {
    const cellCollector = this.indexer.collector({
      type: ForceBridgeCore.config.ckb.ownerCellTypescript,
    });
    for await (const cell of cellCollector.collect()) {
      return cell;
    }
  }

  // fixme: if not find multisig cell, create it
  async fetchMultisigCell(): Promise<Cell | undefined> {
    const multisigLockscript = getMultisigLock(ForceBridgeCore.config.ckb.multisigScript);
    if (!ForceBridgeCore.config.collector) throw new Error('Collector config not set');
    const cellCollector = this.indexer.collector({
      lock: multisigLockscript,
      data: ForceBridgeCore.config.collector.multiCellXchainType,
    });
    for await (const cell of cellCollector.collect()) {
      if (cell.cellOutput.type === null && cell.data === ForceBridgeCore.config.collector.multiCellXchainType) {
        return cell;
      }
    }
  }

  async fetchBridgeCell(bridgeLock: Script, maxTimes: number): Promise<Cell> {
    const cellCollector = this.indexer.collector({
      lock: bridgeLock,
    });
    let index = 0;
    for (;;) {
      if (index > maxTimes) {
        throw new Error('failed to fetch bridge cell.');
      }
      for await (const cell of cellCollector.collect()) {
        if (cell != undefined) {
          return cell;
        }
      }
      logger.debug('try to fetch bridge cell: ', index);
      index += 1;
      await asyncSleep(1000);
    }
  }

  async createBridgeCell(scripts: Script[]): Promise<TransactionSkeletonType> {
    for (;;) {
      try {
        const fromAddress = getFromAddr();
        let txSkeleton = TransactionSkeleton({
          cellProvider: {
            collector: (queryOptions) =>
              this.indexer.collector({ ...queryOptions, type: 'empty', data: { data: '0x', searchMode: 'exact' } }),
          },
        });
        const multisig_cell = await this.fetchMultisigCell();
        txSkeleton = await common.setupInputCell(txSkeleton, multisig_cell!, ForceBridgeCore.config.ckb.multisigScript);
        const bridgeOutputs = scripts.map((script) => {
          const cell: Cell = {
            cellOutput: {
              capacity: '0x0',
              lock: script,
            },
            data: '0x',
          };
          cell.cellOutput.capacity = `0x${minimalCellCapacity(cell).toString(16)}`;
          return cell;
        });
        txSkeleton = txSkeleton.update('outputs', (outputs) => {
          return outputs.push(...bridgeOutputs);
        });
        txSkeleton = await this.completeTx(txSkeleton, fromAddress);
        txSkeleton = common.prepareSigningEntries(txSkeleton);
        return txSkeleton;
      } catch (e) {
        logger.error(`CkbHandler createBridgeCell exception error:${e.message}, stack: ${e.stack}`);
        await asyncSleep(3000);
      }
    }
  }

  async mint(records: MintAssetRecord[]): Promise<TransactionSkeletonType> {
    for (;;) {
      try {
        const fromAddress = getFromAddr();
        let txSkeleton = TransactionSkeleton({
          cellProvider: {
            collector: (queryOptions) =>
              this.indexer.collector({ ...queryOptions, type: 'empty', data: { data: '0x', searchMode: 'exact' } }),
          },
        });
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
            outPoint: ownerCell.outPoint!,
            depType: 'code',
          });
        });

        const mintWitness = this.getMintWitness(records);
        const mintWitnessArgs = bytes.hexify(WitnessArgs.pack({ inputType: mintWitness }));
        txSkeleton = txSkeleton.update('witnesses', (witnesses) => {
          if (witnesses.isEmpty()) {
            return witnesses.push(`0x${mintWitnessArgs}`);
          }
          const witnessArgs = WitnessArgs.unpack(bytes.bytify(witnesses.get(0) as string));
          const newWitnessArgs: IWitnessArgs = {
            inputType: `0x${toHexString(new Uint8Array(mintWitness))}`,
          };
          if (witnessArgs.lock) {
            newWitnessArgs.lock = new Reader(witnessArgs.lock).serializeJson();
          }
          if (witnessArgs.outputType) {
            newWitnessArgs.outputType = new Reader(witnessArgs.outputType).serializeJson();
          }
          return witnesses.set(0, bytes.hexify(WitnessArgs.pack(newWitnessArgs)));
        });

        txSkeleton = await this.buildSudtOutput(txSkeleton, records);
        txSkeleton = await this.buildBridgeCellOutput(txSkeleton, records);
        txSkeleton = await this.completeTx(txSkeleton, fromAddress);
        txSkeleton = common.prepareSigningEntries(txSkeleton);
        return txSkeleton;
      } catch (e) {
        logger.error(`CkbHandler mint exception error:${e.message}, stack: ${e.stack}`);
        await asyncSleep(3000);
      }
    }
  }

  getMintWitness(records: MintAssetRecord[]): ArrayBuffer {
    const lockTxHashes = new Array(0);
    records.forEach((record) => {
      const lockTxHash = fromHexString(toHexString(stringToUint8Array(record.id))).buffer;
      lockTxHashes.push(lockTxHash);
    });
    return SerializeMintWitness({ lock_tx_hashes: lockTxHashes });
  }

  async buildSudtOutput(
    txSkeleton: TransactionSkeletonType,
    records: MintAssetRecord[],
  ): Promise<TransactionSkeletonType> {
    for (const record of records) {
      asserts(record.amount !== 0n, '0 amount should be filtered');
      const recipientLockscript = parseAddress(record.recipient);
      const bridgeCellLockscript = {
        codeHash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
        hashType: ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
        args: record.asset.toBridgeLockscriptArgs(),
      };
      const sudtArgs = utils.computeScriptHash(bridgeCellLockscript);
      const outputSudtCell = <Cell>{
        cellOutput: {
          capacity: '0x0',
          lock: recipientLockscript,
          type: {
            codeHash: ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash,
            hashType: ForceBridgeCore.config.ckb.deps.sudtType.script.hashType,
            args: sudtArgs,
          },
        },
        data: utils.toBigUInt128LE(record.amount) + record.sudtExtraData.slice(2),
      };
      const sudtCapacity = ForceBridgeCore.config.ckb.sudtSize * 10 ** 8;
      logger.debug(
        `check sudtSize: ${JSON.stringify({
          minimal: minimalCellCapacity(outputSudtCell).toString(),
          sudtCapacity: sudtCapacity,
          recipientLockscript,
          extraData: record.sudtExtraData,
        })}`,
      );
      outputSudtCell.cellOutput.capacity = `0x${sudtCapacity.toString(16)}`;
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
    return txSkeleton;
  }

  async buildBridgeCellOutput(
    txSkeleton: TransactionSkeletonType,
    records: MintAssetRecord[],
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
          codeHash: bridgeCellLockscript.codeHash,
          hashType: bridgeCellLockscript.hashType,
          args: bridgeCellLockscript.args,
        },
        5,
      );
      txSkeleton = txSkeleton.update('inputs', (inputs) => {
        return inputs.push(bridge_cell);
      });
      txSkeleton = txSkeleton.update('outputs', (outputs) => {
        return outputs.push(bridge_cell);
      });
    }
    return txSkeleton;
  }

  /*
    table RecipientCellData {
      recipient_address: Bytes,
      chain: byte,
      asset: Bytes,
      bridge_lock_codeHash: Byte32,
      owner_lock_hash: Byte32,
      amount: Uint128,
    }
   */
  async burn(
    fromLockscript: Script,
    recipientAddress: string,
    asset: Asset,
    amount: bigint,
  ): Promise<TransactionSkeletonType> {
    if (amount === 0n) {
      throw new Error('amount should larger then zero!');
    }
    // get sudt cells
    const bridgeCellLockscript = {
      codeHash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
      hashType: ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
      args: asset.toBridgeLockscriptArgs(),
    };
    const args = utils.computeScriptHash(bridgeCellLockscript);
    const searchKey = {
      script: fromLockscript,
      scriptType: 'lock' as ScriptType,
      filter: {
        script: {
          codeHash: ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash,
          args,
          hashType: ForceBridgeCore.config.ckb.deps.sudtType.script.hashType,
        },
      },
    };
    const sudtCells = await this.collector.collectSudtByAmount(searchKey, amount);
    const total = sudtCells.map((cell) => utils.readBigUInt128LE(cell.data)).reduce((a, b) => a + b, 0n);
    if (total < amount) {
      throw new Error('sudt amount is not enough!');
    }
    logger.debug('burn sudtCells: ', sudtCells);
    let txSkeleton = TransactionSkeleton({ cellProvider: this.indexer });
    for (const cell of sudtCells) {
      txSkeleton = await common.setupInputCell(txSkeleton, cell);
    }
    txSkeleton = txSkeleton.update('cellDeps', (cellDeps) => cellDeps.push(this.sudtDep));
    // txSkeleton = txSkeleton.update('inputs', (inputs) => {
    // return inputs.concat(sudtCells);
    // });

    // add recipient output cell
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
      amount: fromHexString(utils.toBigUInt128LE(amount)).buffer,
      bridge_lock_code_hash: fromHexString(ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash).buffer,
      bridge_lock_hash_type: hashType,
      owner_cell_type_hash: fromHexString(ownerCellTypeHash).buffer,
    };

    const recipientCellData = `0x${toHexString(new Uint8Array(SerializeRecipientCellData(params)))}`;
    const recipientTypeScript = {
      codeHash: ForceBridgeCore.config.ckb.deps.recipientType.script.codeHash,
      hashType: ForceBridgeCore.config.ckb.deps.recipientType.script.hashType,
      args: '0x',
    };
    const recipientOutput: Cell = {
      cellOutput: {
        lock: fromLockscript,
        type: recipientTypeScript,
        capacity: '0x0',
      },
      data: recipientCellData,
    };
    const recipientCapacity = minimalCellCapacity(recipientOutput);
    recipientOutput.cellOutput.capacity = `0x${recipientCapacity.toString(16)}`;
    logger.debug(`recipientOutput`, recipientOutput);
    logger.debug(`txSkeleton: ${transactionSkeletonToJSON(txSkeleton)}`);
    txSkeleton = txSkeleton.update('outputs', (outputs) => {
      return outputs.push(recipientOutput);
    });
    logger.debug(`txSkeleton: ${transactionSkeletonToJSON(txSkeleton)}`);
    // sudt change cell
    const changeAmount = total - amount;
    if (changeAmount > 0n) {
      const sudtChangeCell: Cell = lodash.cloneDeep(sudtCells[0]);
      sudtChangeCell.data = utils.toBigUInt128LE(changeAmount);
      const sudtChangeCellCapacity = minimalCellCapacity(sudtChangeCell);
      sudtChangeCell.cellOutput.capacity = `0x${sudtChangeCellCapacity.toString(16)}`;
      txSkeleton = txSkeleton.update('outputs', (outputs) => {
        return outputs.push(sudtChangeCell);
      });
    }
    // add cell deps
    // txSkeleton = txSkeleton.update('cellDeps', (cellDeps) => {
    //   const secp256k1 = nonNullable(this.lumosConfig.SCRIPTS.SECP256K1_BLAKE160);
    //   return cellDeps
    //     .push({
    //       outPoint: {
    //         txHash: secp256k1.TX_HASH,
    //         index: secp256k1.INDEX,
    //       },
    //       depType: secp256k1.DEP_TYPE,
    //     })
    //     .push(this.sudtDep)
    //     .push(this.recipientDep);
    // });

    // add change output
    const changeOutput: Cell = {
      cellOutput: {
        capacity: '0x0',
        lock: fromLockscript,
      },
      data: '0x',
    };
    const minimalChangeCellCapacity = minimalCellCapacity(changeOutput);
    changeOutput.cellOutput.capacity = `0x${minimalChangeCellCapacity.toString(16)}`;
    txSkeleton = txSkeleton.update('outputs', (outputs) => {
      return outputs.push(changeOutput);
    });
    // add inputs
    const fee = 100000n;
    const capacityDiff = await this.calculateCapacityDiff(txSkeleton);
    logger.debug(`capacityDiff`, capacityDiff);
    const needCapacity = -capacityDiff + fee;
    if (needCapacity < 0) {
      txSkeleton = txSkeleton.update('outputs', (outputs) => {
        changeOutput.cellOutput.capacity = `0x${(minimalChangeCellCapacity - needCapacity).toString(16)}`;
        return outputs.set(outputs.size - 1, changeOutput);
      });
    } else {
      const fromCells = await this.collector.getCellsByLockscriptAndCapacity(fromLockscript, needCapacity);
      logger.debug(`fromCells: ${JSON.stringify(fromCells, null, 2)}`);
      txSkeleton = txSkeleton.update('inputs', (inputs) => {
        return inputs.concat(fromCells);
      });
      const capacityDiff = await this.calculateCapacityDiff(txSkeleton);
      if (capacityDiff < fee) {
        const humanReadableCapacityDiff = -capacityDiff / 100000000n + 1n; // 1n is 1 ckb to supply fee
        throw new Error(`fromAddress capacity insufficient, need ${humanReadableCapacityDiff.toString()} CKB more`);
      }
      txSkeleton = txSkeleton.update('outputs', (outputs) => {
        changeOutput.cellOutput.capacity = `0x${(minimalChangeCellCapacity + capacityDiff - fee).toString(16)}`;
        return outputs.set(outputs.size - 1, changeOutput);
      });
    }

    const omniLockConfig = ForceBridgeCore.config.ckb.deps.omniLock;
    if (
      omniLockConfig &&
      fromLockscript.codeHash === omniLockConfig.script.codeHash &&
      fromLockscript.hashType === omniLockConfig.script.hashType
    ) {
      // txSkeleton = txSkeleton.update('cellDeps', (cellDeps) => {
      //   return cellDeps.push({
      //     outPoint: {
      //       txHash: omniLockConfig.cellDep.outPoint.txHash,
      //       index: omniLockConfig.cellDep.outPoint.index,
      //     },
      //     depType: omniLockConfig.cellDep.depType,
      //   });
      // });

      const messageToSign = (() => {
        const hasher = new utils.CKBHasher();
        const rawTxHash = utils.ckbHash(RawTransaction.pack(createTransactionFromSkeleton(txSkeleton)));
        // serialized unsigned witness
        const serializedWitness = bytes.hexify(
          WitnessArgs.pack({
            lock:
              '0x' +
              '00'.repeat(
                SerializeRcLockWitnessLock({
                  signature: new Reader('0x' + '00'.repeat(65)),
                }).byteLength,
              ),
          }),
        );
        hasher.update(rawTxHash);
        const lengthBuffer = new ArrayBuffer(8);
        const view = new DataView(lengthBuffer);
        view.setBigUint64(0, BigInt(new Reader(serializedWitness).length()), true);

        hasher.update(lengthBuffer);
        hasher.update(serializedWitness);
        return hasher.digestHex();
      })();

      txSkeleton = txSkeleton.update('signingEntries', (signingEntries) => {
        return signingEntries.push({
          type: 'witness_args_lock',
          index: 0,
          message: messageToSign,
        });
      });
    }

    logger.debug(`txSkeleton111111111: ${transactionSkeletonToJSON(txSkeleton)}`);
    logger.debug(`final fee: ${await this.calculateCapacityDiff(txSkeleton)}`);

    return txSkeleton;
  }
}

function transformScript(script: Script | undefined | null): Script | null {
  if (script === undefined || script === null) {
    return null;
  }
  return {
    args: script.args,
    codeHash: script.codeHash,
    hashType: script.hashType,
  };
}

export function txSkeletonToRawTransactionToSign(
  txSkeleton: TransactionSkeletonType,
): CKBComponents.RawTransactionToSign {
  const inputs = txSkeleton
    .get('inputs')
    .toArray()
    .map((input) => {
      return <CKBComponents.CellInput>{
        previousOutput: {
          txHash: input.outPoint!.txHash,
          index: input.outPoint!.index,
        },
        since: '0x0',
      };
    });
  const outputs = txSkeleton
    .get('outputs')
    .toArray()
    .map((output) => {
      return {
        capacity: output.cellOutput.capacity,
        lock: transformScript(output.cellOutput.lock),
        type: transformScript(output.cellOutput.type),
      };
    });
  const outputsData = txSkeleton
    .get('outputs')
    .toArray()
    .map((output) => output.data);
  const cellDeps = txSkeleton
    .get('cellDeps')
    .toArray()
    .map((cellDep) => {
      let depType = 'code';
      if (cellDep.depType === 'depGroup') {
        depType = 'depGroup';
      }
      return {
        outPoint: {
          txHash: cellDep.outPoint.txHash,
          index: cellDep.outPoint.index,
        },
        depType,
      };
    });
  const rawTx = {
    version: '0x0',
    cellDeps,
    headerDeps: [],
    inputs,
    outputs,
    witnesses: [{ lock: '', inputType: '', outputType: '' }],
    outputsData,
  };
  logger.debug(`generate burn rawTx: ${JSON.stringify(rawTx, null, 2)}`);
  return rawTx as CKBComponents.RawTransactionToSign;
}
