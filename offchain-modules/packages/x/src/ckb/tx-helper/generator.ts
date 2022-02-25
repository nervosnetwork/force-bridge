import { Cell, CellDep, core, Indexer, Script, utils, WitnessArgs } from '@ckb-lumos/base';
import { SerializeWitnessArgs } from '@ckb-lumos/base/lib/core';
import { common } from '@ckb-lumos/common-scripts';
import { SECP_SIGNATURE_PLACEHOLDER } from '@ckb-lumos/common-scripts/lib/helper';
import {
  createTransactionFromSkeleton,
  minimalCellCapacity,
  parseAddress,
  TransactionSkeleton,
  TransactionSkeletonType,
} from '@ckb-lumos/helpers';
import { normalizers, Reader } from 'ckb-js-toolkit';
import * as lodash from 'lodash';
import { ForceBridgeCore } from '../../core';
import { ICkbUnlock } from '../../db/model';
import { asserts, nonNullable } from '../../errors';
import { asyncSleep, fromHexString, stringToUint8Array, toHexString, transactionSkeletonToJSON } from '../../utils';
import { logger } from '../../utils/logger';
import { Asset, ChainType } from '../model/asset';
import { NervosAsset } from '../model/nervos-asset';
import { CkbTxHelper } from './base_generator';
import { SerializeRecipientCellData } from './generated/eth_recipient_cell';
import { SerializeLockMemo } from './generated/lock_memo';
import { SerializeMintWitness } from './generated/mint_witness';
import { SerializeRcLockWitnessLock } from './generated/omni_lock';
import { SerializeUnlockMemo } from './generated/unlock_memo';
import { ScriptType } from './indexer';
import { getFromAddr, getMultisigLock, getOwnerTypeHash } from './multisig/multisig_helper';
import { getOmniLockMultisigAddress, getOmniLockMultisigWitnessPlaceholder } from './multisig/omni-lock';
import { calculateFee, getTransactionSize } from './utils';

export interface MintAssetRecord {
  id: string;
  asset: Asset;
  amount: bigint;
  recipient: string;
  sudtExtraData: string;
}

export class CkbTxGenerator extends CkbTxHelper {
  sudtDep = {
    out_point: {
      tx_hash: ForceBridgeCore.config.ckb.deps.sudtType.cellDep.outPoint.txHash,
      index: ForceBridgeCore.config.ckb.deps.sudtType.cellDep.outPoint.index,
    },
    dep_type: ForceBridgeCore.config.ckb.deps.sudtType.cellDep.depType,
  };

  recipientDep = {
    out_point: {
      tx_hash: ForceBridgeCore.config.ckb.deps.recipientType.cellDep.outPoint.txHash,
      index: ForceBridgeCore.config.ckb.deps.recipientType.cellDep.outPoint.index,
    },
    dep_type: ForceBridgeCore.config.ckb.deps.recipientType.cellDep.depType,
  };

  bridgeLockDep = {
    out_point: {
      tx_hash: ForceBridgeCore.config.ckb.deps.bridgeLock.cellDep.outPoint.txHash,
      index: ForceBridgeCore.config.ckb.deps.bridgeLock.cellDep.outPoint.index,
    },
    dep_type: ForceBridgeCore.config.ckb.deps.bridgeLock.cellDep.depType,
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

  async fetchOmniLockAdminCell(): Promise<Cell | undefined> {
    const cells = await this.indexer.getCells({
      script: ForceBridgeCore.config.ckb.omniLockAdminCellTypescript,
      script_type: ScriptType.type,
    });
    return cells[0];
    // const cellCollector = this.indexer.collector({
    //   type: ForceBridgeCore.config.ckb.omniLockAdminCellTypescript,
    // });
    // logger.warn(`cells: ${cells}`);
    // if (cells.length < 1) {
    //   return undefined;
    // }
    // for await (const cell of cellCollector.collect()) {
    //   return cell;
    // }
    // return undefined;
  }

  // fixme: if not find multisig cell, create it
  async fetchMultisigCell(): Promise<Cell | undefined> {
    const multisigLockscript = getMultisigLock(ForceBridgeCore.config.ckb.multisigScript);
    const cellCollector = this.indexer.collector({
      lock: multisigLockscript,
    });
    for await (const cell of cellCollector.collect()) {
      if (cell.cell_output.type === null) {
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
        let txSkeleton = TransactionSkeleton({ cellProvider: this.indexer });
        const multisig_cell = await this.fetchMultisigCell();
        txSkeleton = await common.setupInputCell(txSkeleton, multisig_cell!, ForceBridgeCore.config.ckb.multisigScript);
        const bridgeOutputs = scripts.map((script) => {
          const cell: Cell = {
            cell_output: {
              capacity: '0x0',
              lock: script,
            },
            data: '0x',
          };
          cell.cell_output.capacity = `0x${minimalCellCapacity(cell).toString(16)}`;
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
            dep_type: 'code',
          });
        });

        const mintWitness = this.getMintWitness(records);
        const mintWitnessArgs = core.SerializeWitnessArgs({
          lock: null,
          input_type: mintWitness,
          output_type: null,
        });
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
        code_hash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
        hash_type: ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
        args: record.asset.toBridgeLockscriptArgs(),
      };
      const sudtArgs = utils.computeScriptHash(bridgeCellLockscript);
      const outputSudtCell = <Cell>{
        cell_output: {
          capacity: '0x0',
          lock: recipientLockscript,
          type: {
            code_hash: ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash,
            hash_type: ForceBridgeCore.config.ckb.deps.sudtType.script.hashType,
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
      outputSudtCell.cell_output.capacity = `0x${sudtCapacity.toString(16)}`;
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
          code_hash: bridgeCellLockscript.codeHash,
          hash_type: bridgeCellLockscript.hashType,
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
            bridge_lock_code_hash: Byte32,
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
      code_hash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
      hash_type: ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
      args: asset.toBridgeLockscriptArgs(),
    };
    const args = utils.computeScriptHash(bridgeCellLockscript);
    const searchKey = {
      script: fromLockscript,
      script_type: ScriptType.lock,
      filter: {
        script: {
          code_hash: ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash,
          args,
          hash_type: ForceBridgeCore.config.ckb.deps.sudtType.script.hashType,
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
    txSkeleton = txSkeleton.update('inputs', (inputs) => {
      return inputs.concat(sudtCells);
    });

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
      code_hash: ForceBridgeCore.config.ckb.deps.recipientType.script.codeHash,
      hash_type: ForceBridgeCore.config.ckb.deps.recipientType.script.hashType,
      args: '0x',
    };
    const recipientOutput: Cell = {
      cell_output: {
        lock: fromLockscript,
        type: recipientTypeScript,
        capacity: '0x0',
      },
      data: recipientCellData,
    };
    const recipientCapacity = minimalCellCapacity(recipientOutput);
    recipientOutput.cell_output.capacity = `0x${recipientCapacity.toString(16)}`;
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
      sudtChangeCell.cell_output.capacity = `0x${sudtChangeCellCapacity.toString(16)}`;
      txSkeleton = txSkeleton.update('outputs', (outputs) => {
        return outputs.push(sudtChangeCell);
      });
    }
    // add cell deps
    txSkeleton = txSkeleton.update('cellDeps', (cellDeps) => {
      const secp256k1 = nonNullable(this.lumosConfig.SCRIPTS.SECP256K1_BLAKE160);
      return cellDeps
        .push({
          out_point: {
            tx_hash: secp256k1.TX_HASH,
            index: secp256k1.INDEX,
          },
          dep_type: secp256k1.DEP_TYPE,
        })
        .push(this.sudtDep)
        .push(this.recipientDep);
    });
    logger.debug(`txSkeleton: ${transactionSkeletonToJSON(txSkeleton)}`);
    // add change output
    const fee = 100000n;
    const changeOutput: Cell = {
      cell_output: {
        capacity: '0x0',
        lock: fromLockscript,
      },
      data: '0x',
    };
    const minimalChangeCellCapacity = minimalCellCapacity(changeOutput);
    changeOutput.cell_output.capacity = `0x${minimalChangeCellCapacity.toString(16)}`;
    txSkeleton = txSkeleton.update('outputs', (outputs) => {
      return outputs.push(changeOutput);
    });
    // add inputs
    const capacityDiff = await this.calculateCapacityDiff(txSkeleton);
    logger.debug(`capacityDiff`, capacityDiff);
    const needCapacity = -capacityDiff + fee;
    if (needCapacity < 0) {
      txSkeleton = txSkeleton.update('outputs', (outputs) => {
        changeOutput.cell_output.capacity = `0x${(minimalChangeCellCapacity - needCapacity).toString(16)}`;
        return outputs.set(outputs.size - 1, changeOutput);
      });
    } else {
      const fromCells = await this.collector.getCellsByLockscriptAndCapacity(fromLockscript, needCapacity);
      logger.debug(`fromCells: ${JSON.stringify(fromCells, null, 2)}`);
      txSkeleton = txSkeleton.update('inputs', (inputs) => {
        return inputs.concat(fromCells);
      });
      const capacityDiff = await this.calculateCapacityDiff(txSkeleton);
      if (capacityDiff < 0) {
        const humanReadableCapacityDiff = -capacityDiff / 100000000n + (-capacityDiff % 100000000n === 0n ? 0n : 1n);
        throw new Error(`fromAddress capacity insufficient, need ${humanReadableCapacityDiff.toString()} CKB more`);
      }
      txSkeleton = txSkeleton.update('outputs', (outputs) => {
        changeOutput.cell_output.capacity = `0x${(minimalChangeCellCapacity + capacityDiff - fee).toString(16)}`;
        return outputs.set(outputs.size - 1, changeOutput);
      });
    }

    const omniLockConfig = ForceBridgeCore.config.ckb.deps.omniLock;
    if (
      omniLockConfig &&
      fromLockscript.code_hash === omniLockConfig.script.codeHash &&
      fromLockscript.hash_type === omniLockConfig.script.hashType
    ) {
      txSkeleton = txSkeleton.update('cellDeps', (cellDeps) => {
        return cellDeps.push({
          out_point: {
            tx_hash: omniLockConfig.cellDep.outPoint.txHash,
            index: omniLockConfig.cellDep.outPoint.index,
          },
          dep_type: omniLockConfig.cellDep.depType,
        });
      });

      const messageToSign = (() => {
        const hasher = new utils.CKBHasher();
        const rawTxHash = utils.ckbHash(
          core.SerializeRawTransaction(normalizers.NormalizeRawTransaction(createTransactionFromSkeleton(txSkeleton))),
        );
        // serialized unsigned witness
        const serializedWitness = core.SerializeWitnessArgs({
          lock: new Reader(
            '0x' +
              '00'.repeat(
                SerializeRcLockWitnessLock({
                  signature: new Reader('0x' + '00'.repeat(65)),
                }).byteLength,
              ),
          ),
        });
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

    logger.debug(`txSkeleton: ${transactionSkeletonToJSON(txSkeleton)}`);
    logger.debug(`final fee: ${await this.calculateCapacityDiff(txSkeleton)}`);

    return txSkeleton;
  }

  async lock(
    senderLockscript: Script,
    recipientAddress: string,
    assetIdent: string,
    amount: bigint,
    xchain: string,
  ): Promise<CKBComponents.RawTransactionToSign> {
    if (xchain !== 'Ethereum') throw new Error('only support bridge to Ethereum for now');
    const assetInfo = new NervosAsset(assetIdent).getAssetInfo(ChainType.ETH);
    if (!assetInfo) throw new Error('asset not in white list');

    if (assetInfo.typescript)
      return this.lockSUDT(senderLockscript, recipientAddress, assetInfo.typescript.args, amount, xchain);
    return this.lockCKB(senderLockscript, recipientAddress, amount, xchain);
  }

  async lockCKB(
    senderLockscript: Script,
    recipientAddress: string,
    amount: bigint,
    xchain: string,
  ): Promise<CKBComponents.RawTransactionToSign> {
    if (xchain !== 'Ethereum') throw new Error('only support bridge to Ethereum for now');
    if (amount <= 0n) {
      throw new Error('amount should larger then zero!');
    }

    let txSkeleton = TransactionSkeleton({ cellProvider: this.indexer });

    // add cellDeps
    const secp256k1 = nonNullable(this.lumosConfig.SCRIPTS.SECP256K1_BLAKE160);
    const omniLockConfig = ForceBridgeCore.config.ckb.deps.omniLock;
    if (senderLockscript.code_hash === secp256k1.CODE_HASH && senderLockscript.hash_type === secp256k1.HASH_TYPE) {
      txSkeleton = txSkeleton.update('cellDeps', (cellDeps) => {
        return cellDeps.push({
          out_point: {
            tx_hash: secp256k1.TX_HASH,
            index: secp256k1.INDEX,
          },
          dep_type: secp256k1.DEP_TYPE,
        });
      });
    } else if (
      senderLockscript.code_hash === ForceBridgeCore.config.ckb.deps.pwLock?.script.codeHash &&
      senderLockscript.hash_type === ForceBridgeCore.config.ckb.deps.pwLock?.script.hashType
    ) {
      txSkeleton = txSkeleton.update('cellDeps', (cellDeps) => {
        return cellDeps.push(
          {
            out_point: {
              tx_hash: ForceBridgeCore.config.ckb.deps.pwLock!.cellDep.outPoint.txHash,
              index: ForceBridgeCore.config.ckb.deps.pwLock!.cellDep.outPoint.index,
            },
            dep_type: ForceBridgeCore.config.ckb.deps.pwLock!.cellDep.depType,
          },
          {
            out_point: {
              tx_hash: secp256k1.TX_HASH,
              index: secp256k1.INDEX,
            },
            dep_type: secp256k1.DEP_TYPE,
          },
        );
      });
    } else if (
      omniLockConfig &&
      senderLockscript.code_hash === omniLockConfig.script.codeHash &&
      senderLockscript.hash_type === omniLockConfig.script.codeHash
    ) {
      txSkeleton = txSkeleton.update('cellDeps', (cellDeps) => {
        return cellDeps.push(
          {
            out_point: {
              tx_hash: omniLockConfig.cellDep.outPoint.txHash,
              index: omniLockConfig.cellDep.outPoint.index,
            },
            dep_type: omniLockConfig.cellDep.depType,
          },
          {
            out_point: {
              tx_hash: secp256k1.TX_HASH,
              index: secp256k1.INDEX,
            },
            dep_type: secp256k1.DEP_TYPE,
          },
        );
      });
    } else {
      throw new Error('unsupported sender address!');
    }

    // add inputs
    const senderOutputChangeCell: Cell = {
      cell_output: {
        capacity: '0x0',
        lock: senderLockscript,
      },
      data: '0x',
    };
    const senderOutputChangeCellMinimalCapacity = minimalCellCapacity(senderOutputChangeCell);
    const bridgeFee = BigInt(ForceBridgeCore.config.eth.lockNervosAssetFee);
    const senderNeedSupplyCapacity =
      amount + bridgeFee + senderOutputChangeCellMinimalCapacity + 1n * BigInt(100000000); // tx fee
    const searchedSenderCells = await this.collector.getCellsByLockscriptAndCapacity(
      senderLockscript,
      senderNeedSupplyCapacity,
    );
    const searchedSenderCellsCapacity = searchedSenderCells
      .map((cell) => BigInt(cell.cell_output.capacity))
      .reduce((a, b) => a + b, 0n);
    if (searchedSenderCellsCapacity < senderNeedSupplyCapacity)
      throw new Error(
        `sender ckb capacity not enough, need ${senderNeedSupplyCapacity.toString()}, found ${searchedSenderCellsCapacity.toString()}`,
      );
    txSkeleton = txSkeleton.update('inputs', (inputs) => {
      return inputs.push(...searchedSenderCells);
    });

    // add outputs
    const committeeMultisigLockscript = parseAddress(getOmniLockMultisigAddress());
    const committeeMultisigCell: Cell = {
      cell_output: {
        capacity: `0x${(amount + bridgeFee).toString(16)}`,
        lock: committeeMultisigLockscript,
      },
      data: '0x',
    };
    senderOutputChangeCell.cell_output.capacity = `0x${(searchedSenderCellsCapacity - amount - bridgeFee).toString(
      16,
    )}`;
    txSkeleton = txSkeleton.update('outputs', (outputs) => {
      return outputs.push(committeeMultisigCell, senderOutputChangeCell);
    });

    // add witnesses
    const witnesses = lodash.range(searchedSenderCells.length).map((index) => {
      if (index === 0) {
        return new Reader(
          SerializeWitnessArgs(
            normalizers.NormalizeWitnessArgs({
              lock: SECP_SIGNATURE_PLACEHOLDER,
            }),
          ),
        ).serializeJson();
      }
      return '0x';
    });

    const lockMemo = SerializeLockMemo({ xchain: 1, recipient: new Reader(recipientAddress).toArrayBuffer() });
    // put lockMemo in witnesses[inputs.len]
    witnesses.push(new Reader(lockMemo).serializeJson());
    txSkeleton = txSkeleton.update('witnesses', (w) => {
      return w.push(...witnesses);
    });

    // tx fee
    const txFee = calculateFee(getTransactionSize(txSkeleton));
    txSkeleton = txSkeleton.update('outputs', (outputs) => {
      return outputs.map((cell, index) => {
        if (index === 1) {
          cell.cell_output.capacity = `0x${(BigInt(cell.cell_output.capacity) - txFee).toString(16)}`;
        }
        return cell;
      });
    });

    return txSkeletonToRawTransactionToSign(txSkeleton, false);
  }

  async lockSUDT(
    senderLockscript: Script,
    recipientAddress: string,
    sudtArgs: string,
    amount: bigint,
    xchain: string,
  ): Promise<CKBComponents.RawTransactionToSign> {
    if (xchain !== 'Ethereum') throw new Error('only support bridge to Ethereum for now');
    if (amount <= 0n) {
      throw new Error('amount should larger then zero!');
    }

    let txSkeleton = TransactionSkeleton({ cellProvider: this.indexer });
    // add cellDeps
    const secp256k1 = nonNullable(this.lumosConfig.SCRIPTS.SECP256K1_BLAKE160);
    const omniLockConfig = ForceBridgeCore.config.ckb.deps.omniLock;
    if (senderLockscript.code_hash === secp256k1.CODE_HASH && senderLockscript.hash_type === secp256k1.HASH_TYPE) {
      txSkeleton = txSkeleton.update('cellDeps', (cellDeps) => {
        return cellDeps.push({
          out_point: {
            tx_hash: secp256k1.TX_HASH,
            index: secp256k1.INDEX,
          },
          dep_type: secp256k1.DEP_TYPE,
        });
      });
    } else if (
      senderLockscript.code_hash === ForceBridgeCore.config.ckb.deps.pwLock?.script.codeHash &&
      senderLockscript.hash_type === ForceBridgeCore.config.ckb.deps.pwLock?.script.hashType
    ) {
      txSkeleton = txSkeleton.update('cellDeps', (cellDeps) => {
        return cellDeps.push(
          {
            out_point: {
              tx_hash: ForceBridgeCore.config.ckb.deps.pwLock!.cellDep.outPoint.txHash,
              index: ForceBridgeCore.config.ckb.deps.pwLock!.cellDep.outPoint.index,
            },
            dep_type: ForceBridgeCore.config.ckb.deps.pwLock!.cellDep.depType,
          },
          {
            out_point: {
              tx_hash: secp256k1.TX_HASH,
              index: secp256k1.INDEX,
            },
            dep_type: secp256k1.DEP_TYPE,
          },
        );
      });
    } else if (
      omniLockConfig &&
      senderLockscript.code_hash === omniLockConfig.script.codeHash &&
      senderLockscript.hash_type === omniLockConfig.script.codeHash
    ) {
      txSkeleton = txSkeleton.update('cellDeps', (cellDeps) => {
        return cellDeps.push(
          {
            out_point: {
              tx_hash: omniLockConfig.cellDep.outPoint.txHash,
              index: omniLockConfig.cellDep.outPoint.index,
            },
            dep_type: omniLockConfig.cellDep.depType,
          },
          {
            out_point: {
              tx_hash: secp256k1.TX_HASH,
              index: secp256k1.INDEX,
            },
            dep_type: secp256k1.DEP_TYPE,
          },
        );
      });
    } else {
      throw new Error('unsupported sender address!');
    }

    const sudtScript = {
      code_hash: ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash,
      hash_type: ForceBridgeCore.config.ckb.deps.sudtType.script.hashType,
      args: sudtArgs,
    };
    const bridgeFee = BigInt(ForceBridgeCore.config.eth.lockNervosAssetFee);

    // add committee multisig output
    const committeeMultisigLockscript = parseAddress(getOmniLockMultisigAddress());
    const committeeMultisigCell: Cell = {
      cell_output: {
        capacity: `0x${bridgeFee.toString(16)}`, // bridge fee
        lock: committeeMultisigLockscript,
        type: sudtScript,
      },
      data: utils.toBigUInt128LE(amount), // locked sudt amount
    };
    txSkeleton = txSkeleton.update('outputs', (outputs) => {
      return outputs.push(committeeMultisigCell);
    });

    // collect sudt
    const searchKey = {
      script: senderLockscript,
      script_type: ScriptType.lock,
      filter: {
        script: sudtScript,
      },
    };
    const sudtCells = await this.collector.collectSudtByAmount(searchKey, amount);
    const total = sudtCells.map((cell) => utils.readBigUInt128LE(cell.data)).reduce((a, b) => a + b, 0n);
    if (total < amount) {
      throw new Error('sudt amount is not enough!');
    }
    logger.debug('lock sudtCells: ', sudtCells);

    // add sudt inputs
    txSkeleton = txSkeleton.update('inputs', (inputs) => {
      return inputs.concat(sudtCells);
    });

    // ckb change output cell
    const senderOutputCkbChangeCell: Cell = {
      cell_output: {
        capacity: '0x0',
        lock: senderLockscript,
      },
      data: '0x',
    };
    const senderOutputCkbChangeCellMinimalCapacity = minimalCellCapacity(senderOutputCkbChangeCell);
    let senderOutputSudtChangeCellMinimalCapacity = BigInt(0);
    if (total > amount) {
      // sudt change output cell
      const senderOutputSudtChangeCell: Cell = {
        cell_output: {
          capacity: '0x0',
          lock: senderLockscript,
          type: sudtScript,
        },
        data: utils.toBigUInt128LE(total - amount),
      };
      senderOutputSudtChangeCellMinimalCapacity = minimalCellCapacity(senderOutputSudtChangeCell);
      senderOutputSudtChangeCell.cell_output.capacity = `0x${senderOutputSudtChangeCellMinimalCapacity.toString(16)}`;
      // add sudt change output
      txSkeleton = txSkeleton.update('outputs', (outputs) => {
        return outputs.push(senderOutputSudtChangeCell);
      });
    }
    // collect ckb
    const totalCapacityOfSudtCellsInInputs = sudtCells
      .map((cell) => BigInt(cell.cell_output.capacity))
      .reduce((a, b) => a + b, 0n);
    const outputNeedCapacity =
      bridgeFee +
      senderOutputSudtChangeCellMinimalCapacity +
      senderOutputCkbChangeCellMinimalCapacity +
      1n * BigInt(100000000); // tx fee

    let senderNeedCkbSupplyCapacity = BigInt(0);
    let searchedSenderCkbCellsCapacity = BigInt(0);
    let inputCellLength = sudtCells.length;
    if (totalCapacityOfSudtCellsInInputs < outputNeedCapacity) {
      // inputs capacity does not offset outputs capacity, collect ckb
      senderNeedCkbSupplyCapacity = outputNeedCapacity - totalCapacityOfSudtCellsInInputs;
      const searchedSenderCkbCells = await this.collector.getCellsByLockscriptAndCapacity(
        senderLockscript,
        senderNeedCkbSupplyCapacity,
      );
      searchedSenderCkbCellsCapacity = searchedSenderCkbCells
        .map((cell) => BigInt(cell.cell_output.capacity))
        .reduce((a, b) => a + b, 0n);
      inputCellLength += searchedSenderCkbCells.length;
      if (searchedSenderCkbCellsCapacity < senderNeedCkbSupplyCapacity)
        throw new Error(
          `sender ckb capacity not enough, need ${senderNeedCkbSupplyCapacity.toString()}, found ${searchedSenderCkbCellsCapacity.toString()}`,
        );

      // add ckb inputs
      txSkeleton = txSkeleton.update('inputs', (inputs) => {
        return inputs.concat(searchedSenderCkbCells);
      });
    }
    // add ckb change output
    senderOutputCkbChangeCell.cell_output.capacity = `0x${(
      totalCapacityOfSudtCellsInInputs +
      searchedSenderCkbCellsCapacity -
      senderOutputCkbChangeCellMinimalCapacity -
      senderOutputSudtChangeCellMinimalCapacity -
      bridgeFee
    ).toString(16)}`;

    txSkeleton = txSkeleton.update('outputs', (outputs) => {
      return outputs.push(senderOutputCkbChangeCell);
    });

    // add witnesses
    const witnesses = lodash.range(inputCellLength).map((index) => {
      if (index === 0) {
        return new Reader(
          SerializeWitnessArgs(
            normalizers.NormalizeWitnessArgs({
              lock: SECP_SIGNATURE_PLACEHOLDER,
            }),
          ),
        ).serializeJson();
      }
      return '0x';
    });
    const lockMemo = SerializeLockMemo({ xchain: 1, recipient: new Reader(recipientAddress).toArrayBuffer() });
    // put lockMemo in witnesses[inputs.len]
    witnesses.push(new Reader(lockMemo).serializeJson());
    txSkeleton = txSkeleton.update('witnesses', (w) => {
      return w.push(...witnesses);
    });

    // tx fee
    const txFee = calculateFee(getTransactionSize(txSkeleton));
    txSkeleton = txSkeleton.update('outputs', (outputs) => {
      return outputs.map((cell, index) => {
        if ((total === amount && index === 1) || (total > amount && index === 2)) {
          cell.cell_output.capacity = `0x${(BigInt(cell.cell_output.capacity) - txFee).toString(16)}`;
        }
        return cell;
      });
    });

    return txSkeletonToRawTransactionToSign(txSkeleton, false);
  }

  async unlock(records: ICkbUnlock[]): Promise<TransactionSkeletonType | undefined> {
    records = records.filter((r) => r.xchain === ChainType.ETH);
    const assetIdent = records[0].assetIdent;
    if (!assetIdent || assetIdent === '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff') {
      return await this.unlockCKB(
        records.map((r) => ({ burnId: r.id, recipient: r.recipientAddress, amount: r.amount })),
      );
    } else {
      const assetInfo = new NervosAsset(assetIdent).getAssetInfo(ChainType.ETH);
      if (!assetInfo) {
        return;
      }
      const sudtArgs = assetInfo.typescript!.args;
      return await this.unlockSUDT(
        sudtArgs,
        records.map((r) => ({
          burnId: r.id,
          recipient: r.recipientAddress,
          amount: r.amount,
        })),
      );
    }
  }

  async unlockCKB(records: { burnId: string; recipient: string; amount: string }[]): Promise<TransactionSkeletonType> {
    const collectorAddress = getFromAddr();

    let txSkeleton = TransactionSkeleton({
      cellProvider: this.indexer,
    });

    // search admin cell
    const adminCell = await this.fetchOmniLockAdminCell();
    const adminCellOutpoint = adminCell?.out_point;
    if (!adminCellOutpoint) throw new Error('omni lock admin cell outpoint could not be null');
    const adminCellCellDep: CellDep = {
      out_point: adminCellOutpoint,
      dep_type: 'code',
    };

    // add cellDeps
    txSkeleton = txSkeleton.update('cellDeps', (cellDeps) => {
      const found = nonNullable(this.lumosConfig.SCRIPTS.SECP256K1_BLAKE160);
      return cellDeps.push({
        dep_type: found.DEP_TYPE,
        out_point: { tx_hash: found.TX_HASH, index: found.INDEX },
      });
    });
    txSkeleton = txSkeleton.update('cellDeps', (cellDeps) => {
      return cellDeps.push(adminCellCellDep);
    });
    txSkeleton = txSkeleton.update('cellDeps', (cellDeps) => {
      const omniLockCellDep = nonNullable(ForceBridgeCore.config.ckb.deps.omniLock?.cellDep);
      return cellDeps.push({
        out_point: {
          tx_hash: omniLockCellDep.outPoint.txHash,
          index: omniLockCellDep.outPoint.index,
        },
        dep_type: omniLockCellDep.depType,
      });
    });

    // add recipient outputs
    records.forEach((record) => {
      const recipientCell: Cell = {
        cell_output: {
          capacity: `0x${BigInt(record.amount).toString(16)}`,
          lock: parseAddress(record.recipient),
        },
        data: '0x',
      };
      txSkeleton = txSkeleton.update('outputs', (outputs) => {
        return outputs.push(recipientCell);
      });
    });

    const omniLockMultisigScript = parseAddress(getOmniLockMultisigAddress());
    const omniLockMultisigChangeCell: Cell = {
      cell_output: {
        capacity: `0x0`,
        lock: omniLockMultisigScript,
      },
      data: '0x',
    };
    const omniLockMultisigChangeCellMinimalCapacity = minimalCellCapacity(omniLockMultisigChangeCell);

    // add multisig cell inputs
    const totalTransferredCKB = records.map((record) => BigInt(record.amount)).reduce((a, b) => a + b, 0n);
    const multisigNeedCapacity = totalTransferredCKB + omniLockMultisigChangeCellMinimalCapacity;
    const searchedMultisigCells = await this.collector.getCellsByLockscriptAndCapacity(
      omniLockMultisigScript,
      multisigNeedCapacity,
    );
    const searchedMultisigCellsCapacity = searchedMultisigCells
      .map((cell) => BigInt(cell.cell_output.capacity))
      .reduce((a, b) => a + b, 0n);
    if (searchedMultisigCellsCapacity < multisigNeedCapacity)
      throw new Error(
        `multisig cell ckb capacity not enough, need ${multisigNeedCapacity.toString()}, found ${searchedMultisigCellsCapacity.toString()}`,
      );
    txSkeleton = txSkeleton.update('inputs', (inputs) => {
      return inputs.push(...searchedMultisigCells);
    });

    // add multisigChangeCell
    const multisigChangeCellCapacity = searchedMultisigCellsCapacity - totalTransferredCKB;
    omniLockMultisigChangeCell.cell_output.capacity = `0x${multisigChangeCellCapacity.toString(16)}`;
    txSkeleton = txSkeleton.update('outputs', (outputs) => {
      return outputs.push(omniLockMultisigChangeCell);
    });

    // add collector cell to pay tx fee
    const collectorLockscript = parseAddress(collectorAddress);
    const collectorChangeCell: Cell = {
      cell_output: {
        capacity: `0x0`,
        lock: collectorLockscript,
      },
      data: '0x',
    };
    const collectorChangeCellMinimalCapacity = minimalCellCapacity(collectorChangeCell);
    const collectorNeedCapacity = collectorChangeCellMinimalCapacity + BigInt(100000000);
    const searchedCollectorCells = await this.collector.getCellsByLockscriptAndCapacity(
      collectorLockscript,
      collectorNeedCapacity,
    );
    const searchedCollectorCellsCapacity = searchedCollectorCells
      .map((cell) => BigInt(cell.cell_output.capacity))
      .reduce((a, b) => a + b, 0n);
    if (searchedCollectorCellsCapacity < collectorNeedCapacity)
      throw new Error(
        `collector cell ckb capacity not enough, need ${collectorNeedCapacity.toString()}, found ${searchedCollectorCellsCapacity.toString()}`,
      );
    txSkeleton = txSkeleton.update('inputs', (inputs) => {
      return inputs.push(...searchedCollectorCells);
    });
    collectorChangeCell.cell_output.capacity = `0x${searchedCollectorCellsCapacity.toString(16)}`;
    txSkeleton = txSkeleton.update('outputs', (outputs) => {
      return outputs.push(collectorChangeCell);
    });

    // add witness
    const omniLockWitnessPlaceholder = getOmniLockMultisigWitnessPlaceholder();
    const omniLockWitnessGroup = lodash.range(searchedMultisigCells.length).map((index) => {
      if (index === 0) return omniLockWitnessPlaceholder;
      return '0x';
    });
    txSkeleton = txSkeleton.update('witnesses', (witnesses) => {
      return witnesses.push(...omniLockWitnessGroup);
    });
    const collectorWitness = new Reader(
      SerializeWitnessArgs(
        normalizers.NormalizeWitnessArgs({
          lock: SECP_SIGNATURE_PLACEHOLDER,
        }),
      ),
    ).serializeJson();
    const collectorWitnessGroup = lodash.range(searchedCollectorCells.length).map((index) => {
      if (index === 0) return collectorWitness;
      return '0x';
    });
    txSkeleton = txSkeleton.update('witnesses', (witnesses) => {
      return witnesses.push(...collectorWitnessGroup);
    });
    const burnIds = records
      .filter((record) => record.burnId.indexOf('-') >= 0)
      .map((record) => {
        const burnId = record.burnId;
        const burnHashSeparatorIndex = burnId.indexOf('-');
        const burnTxHash = burnId.substring(0, burnHashSeparatorIndex);
        const logIndex = burnId.substring(burnHashSeparatorIndex + 1);
        const logIndexHex = BigInt(logIndex).toString(16);
        const logIndexReader = new Reader(`0x${logIndexHex.length % 2 === 0 ? '' : '0'}${logIndexHex}`);
        return {
          burnTxHash: new Reader(burnTxHash),
          logIndex: logIndexReader,
        };
      });
    const unlockMemo = SerializeUnlockMemo({
      xchain: 1,
      burnIds,
    });
    // put unlockMemo in witnesses[inputs.len]
    txSkeleton = txSkeleton.update('witnesses', (witnesses) => {
      return witnesses.push(new Reader(unlockMemo).serializeJson());
    });

    // pay tx fee
    const txFee = calculateFee(getTransactionSize(txSkeleton));
    txSkeleton = txSkeleton.update('outputs', (outputs) => {
      return outputs.map((cell) => {
        if (
          cell.cell_output.lock.args === collectorLockscript.args &&
          cell.cell_output.lock.hash_type === collectorLockscript.hash_type &&
          cell.cell_output.lock.code_hash === collectorLockscript.code_hash
        ) {
          cell.cell_output.capacity = `0x${(BigInt(cell.cell_output.capacity) - txFee).toString(16)}`;
        }
        return cell;
      });
    });

    // Lumos not support omni-lock, so we use a tricky way to workaround
    const trickyLumosConfig = {
      PREFIX: this.lumosConfig.PREFIX,
      SCRIPTS: {
        SECP256K1_BLAKE160_MULTISIG: {
          CODE_HASH: nonNullable(ForceBridgeCore.config.ckb.deps.omniLock?.script.codeHash),
          HASH_TYPE: nonNullable(ForceBridgeCore.config.ckb.deps.omniLock?.script.hashType) as 'type' | 'data',
          TX_HASH: nonNullable(ForceBridgeCore.config.ckb.deps.omniLock?.cellDep.outPoint.txHash),
          INDEX: nonNullable(ForceBridgeCore.config.ckb.deps.omniLock?.cellDep.outPoint.index),
          DEP_TYPE: nonNullable(ForceBridgeCore.config.ckb.deps.omniLock?.cellDep.depType),
        },
        SECP256K1_BLAKE160: this.lumosConfig.SCRIPTS.SECP256K1_BLAKE160,
      },
    };
    txSkeleton = common.prepareSigningEntries(txSkeleton, {
      config: trickyLumosConfig,
    });

    return txSkeleton;
  }

  async unlockSUDT(
    sudtArgs: string,
    records: { burnId: string; recipient: string; amount: string }[],
  ): Promise<TransactionSkeletonType> {
    const collectorAddress = getFromAddr();

    let txSkeleton = TransactionSkeleton({
      cellProvider: this.indexer,
    });

    // search admin cell
    const adminCell = await this.fetchOmniLockAdminCell();
    const adminCellOutpoint = adminCell?.out_point;
    if (!adminCellOutpoint) throw new Error('omni lock admin cell outpoint could not be null');
    const adminCellCellDep: CellDep = {
      out_point: adminCellOutpoint,
      dep_type: 'code',
    };

    // add cellDeps
    txSkeleton = txSkeleton.update('cellDeps', (cellDeps) => {
      const found = nonNullable(this.lumosConfig.SCRIPTS.SECP256K1_BLAKE160);
      return cellDeps.push({
        dep_type: found.DEP_TYPE,
        out_point: { tx_hash: found.TX_HASH, index: found.INDEX },
      });
    });
    txSkeleton = txSkeleton.update('cellDeps', (cellDeps) => {
      return cellDeps.push(adminCellCellDep);
    });
    txSkeleton = txSkeleton.update('cellDeps', (cellDeps) => {
      const omniLockCellDep = nonNullable(ForceBridgeCore.config.ckb.deps.omniLock?.cellDep);
      return cellDeps.push({
        out_point: {
          tx_hash: omniLockCellDep.outPoint.txHash,
          index: omniLockCellDep.outPoint.index,
        },
        dep_type: omniLockCellDep.depType,
      });
    });

    const sudtScript = {
      code_hash: ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash,
      hash_type: ForceBridgeCore.config.ckb.deps.sudtType.script.hashType,
      args: sudtArgs,
    };

    let totalSudtOutputCapacity = BigInt(0);
    let totalSudtOutputAmount = BigInt(0);
    const sudtCapacity = BigInt(ForceBridgeCore.config.ckb.sudtSize * 10 ** 8);
    // add recipient outputs
    records.forEach((record) => {
      const amount = BigInt(record.amount);
      const recipientCell: Cell = {
        cell_output: {
          capacity: `0x${sudtCapacity.toString(16)}`,
          lock: parseAddress(record.recipient),
          type: sudtScript,
        },
        data: utils.toBigUInt128LE(amount),
      };
      totalSudtOutputCapacity += sudtCapacity;
      totalSudtOutputAmount += amount;
      txSkeleton = txSkeleton.update('outputs', (outputs) => {
        return outputs.push(recipientCell);
      });
    });

    // collect sudt and add multisig cell inputs
    const omniLockMultisigScript = parseAddress(getOmniLockMultisigAddress());
    const searchKey = {
      script: omniLockMultisigScript,
      script_type: ScriptType.lock,
      filter: {
        script: sudtScript,
      },
    };

    const searchedMultisigCells = await this.collector.collectSudtByAmount(searchKey, totalSudtOutputAmount);
    const searchedMultisigCellsAmount = searchedMultisigCells
      .map((cell) => utils.readBigUInt128LE(cell.data))
      .reduce((a, b) => a + b, 0n);
    const searchedMultisigCellsCapacity = searchedMultisigCells
      .map((cell) => BigInt(cell.cell_output.capacity))
      .reduce((a, b) => a + b, 0n);

    // add multisigChangeCell if searchedMultisigCellsAmount === totalSudtOutputAmount then use ckb cell for change
    let omniLockMultisigChangeCell: Cell;
    if (searchedMultisigCellsAmount > totalSudtOutputAmount) {
      omniLockMultisigChangeCell = {
        cell_output: {
          capacity: `0x${searchedMultisigCellsCapacity.toString(16)}`,
          lock: omniLockMultisigScript,
          type: sudtScript,
        },
        data: utils.toBigUInt128LE(searchedMultisigCellsAmount - totalSudtOutputAmount),
      };
    } else if (searchedMultisigCellsAmount === totalSudtOutputAmount) {
      omniLockMultisigChangeCell = {
        cell_output: {
          capacity: `0x${searchedMultisigCellsCapacity.toString(16)}`,
          lock: omniLockMultisigScript,
        },
        data: '0x',
      };
    } else {
      throw new Error(
        `multisig cell sudt amount not enough, need ${totalSudtOutputAmount.toString()}, found ${searchedMultisigCellsAmount.toString()}`,
      );
    }
    txSkeleton = txSkeleton.update('inputs', (inputs) => {
      return inputs.push(...searchedMultisigCells);
    });
    txSkeleton = txSkeleton.update('outputs', (outputs) => {
      return outputs.push(omniLockMultisigChangeCell);
    });

    // add collector cell to pay tx fee
    const collectorLockscript = parseAddress(collectorAddress);
    const collectorChangeCell: Cell = {
      cell_output: {
        capacity: `0x0`,
        lock: collectorLockscript,
      },
      data: '0x',
    };
    const collectorChangeCellMinimalCapacity = minimalCellCapacity(collectorChangeCell);
    const collectorNeedCapacity = totalSudtOutputCapacity + collectorChangeCellMinimalCapacity + 1n * BigInt(100000000);
    const searchedCollectorCells = await this.collector.getCellsByLockscriptAndCapacity(
      collectorLockscript,
      collectorNeedCapacity,
    );
    const searchedCollectorCellsCapacity = searchedCollectorCells
      .map((cell) => BigInt(cell.cell_output.capacity))
      .reduce((a, b) => a + b, 0n);
    if (searchedCollectorCellsCapacity < collectorNeedCapacity)
      throw new Error(
        `collector cell ckb capacity not enough, need ${collectorNeedCapacity.toString()}, found ${searchedCollectorCellsCapacity.toString()}`,
      );
    txSkeleton = txSkeleton.update('inputs', (inputs) => {
      return inputs.push(...searchedCollectorCells);
    });
    const collectorChangeCapacity = searchedCollectorCellsCapacity - totalSudtOutputCapacity;
    collectorChangeCell.cell_output.capacity = `0x${collectorChangeCapacity.toString(16)}`;
    txSkeleton = txSkeleton.update('outputs', (outputs) => {
      return outputs.push(collectorChangeCell);
    });

    // add witness
    const omniLockWitnessPlaceholder = getOmniLockMultisigWitnessPlaceholder();
    const omniLockWitnessGroup = lodash.range(searchedMultisigCells.length).map((index) => {
      if (index === 0) return omniLockWitnessPlaceholder;
      return '0x';
    });
    txSkeleton = txSkeleton.update('witnesses', (witnesses) => {
      return witnesses.push(...omniLockWitnessGroup);
    });
    const collectorWitness = new Reader(
      SerializeWitnessArgs(
        normalizers.NormalizeWitnessArgs({
          lock: SECP_SIGNATURE_PLACEHOLDER,
        }),
      ),
    ).serializeJson();
    const collectorWitnessGroup = lodash.range(searchedCollectorCells.length).map((index) => {
      if (index === 0) return collectorWitness;
      return '0x';
    });
    txSkeleton = txSkeleton.update('witnesses', (witnesses) => {
      return witnesses.push(...collectorWitnessGroup);
    });

    const unlockMemo = SerializeUnlockMemo({
      xchain: 1,
      burnIds: records.map((record) => new Reader(record.burnId)),
    });
    // put unlockMemo in witnesses[inputs.len]
    txSkeleton = txSkeleton.update('witnesses', (witnesses) => {
      return witnesses.push(new Reader(unlockMemo).serializeJson());
    });

    // pay tx fee
    const txFee = calculateFee(getTransactionSize(txSkeleton));
    txSkeleton = txSkeleton.update('outputs', (outputs) => {
      return outputs.map((cell) => {
        if (
          cell.cell_output.lock.args === collectorLockscript.args &&
          cell.cell_output.lock.hash_type === collectorLockscript.hash_type &&
          cell.cell_output.lock.code_hash === collectorLockscript.code_hash
        ) {
          cell.cell_output.capacity = `0x${(BigInt(cell.cell_output.capacity) - txFee).toString(16)}`;
        }
        return cell;
      });
    });

    // Lumos not support omni-lock, so we use a tricky way to workaround
    const trickyLumosConfig = {
      PREFIX: this.lumosConfig.PREFIX,
      SCRIPTS: {
        SECP256K1_BLAKE160_MULTISIG: {
          CODE_HASH: nonNullable(ForceBridgeCore.config.ckb.deps.omniLock?.script.codeHash),
          HASH_TYPE: nonNullable(ForceBridgeCore.config.ckb.deps.omniLock?.script.hashType) as 'type' | 'data',
          TX_HASH: nonNullable(ForceBridgeCore.config.ckb.deps.omniLock?.cellDep.outPoint.txHash),
          INDEX: nonNullable(ForceBridgeCore.config.ckb.deps.omniLock?.cellDep.outPoint.index),
          DEP_TYPE: nonNullable(ForceBridgeCore.config.ckb.deps.omniLock?.cellDep.depType),
        },
        SECP256K1_BLAKE160: this.lumosConfig.SCRIPTS.SECP256K1_BLAKE160,
      },
    };
    txSkeleton = common.prepareSigningEntries(txSkeleton, {
      config: trickyLumosConfig,
    });

    return txSkeleton;
  }
}

function transformScript(script: Script | undefined | null): CKBComponents.Script | null {
  if (script === undefined || script === null) {
    return null;
  }
  return {
    args: script.args,
    codeHash: script.code_hash,
    hashType: script.hash_type,
  };
}

export function txSkeletonToRawTransactionToSign(
  txSkeleton: TransactionSkeletonType,
  clearWitness = true,
): CKBComponents.RawTransactionToSign {
  const inputs = txSkeleton
    .get('inputs')
    .toArray()
    .map((input) => {
      return <CKBComponents.CellInput>{
        previousOutput: {
          txHash: input.out_point!.tx_hash,
          index: input.out_point!.index,
        },
        since: '0x0',
      };
    });
  const outputs = txSkeleton
    .get('outputs')
    .toArray()
    .map((output) => {
      return {
        capacity: output.cell_output.capacity,
        lock: transformScript(output.cell_output.lock),
        type: transformScript(output.cell_output.type),
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
      if (cellDep.dep_type === 'dep_group') {
        depType = 'depGroup';
      }
      return {
        outPoint: {
          txHash: cellDep.out_point.tx_hash,
          index: cellDep.out_point.index,
        },
        depType,
      };
    });
  const witnesses = clearWitness ? [{ lock: '', inputType: '', outputType: '' }] : txSkeleton.witnesses.toArray();
  const rawTx = {
    version: '0x0',
    cellDeps,
    headerDeps: [],
    inputs,
    outputs,
    witnesses: witnesses,
    outputsData,
  };
  logger.debug(`generate rawTx: ${JSON.stringify(rawTx, null, 2)}`);
  return rawTx as CKBComponents.RawTransactionToSign;
}
