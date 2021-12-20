import { Cell, HashType, OutPoint, Script, utils as lumosUtils } from '@ckb-lumos/base';
import { common } from '@ckb-lumos/common-scripts';
import { key } from '@ckb-lumos/hd';
import {
  generateSecp256k1Blake160Address,
  minimalCellCapacity,
  parseAddress,
  sealTransaction,
  TransactionSkeleton,
  TransactionSkeletonType,
} from '@ckb-lumos/helpers';
import * as utils from '@nervosnetwork/ckb-sdk-utils';
import { Reader } from 'ckb-js-toolkit';
import { ConfigItem, MultisigItem } from '../../config';
import { asserts, nonNullable } from '../../errors';
import { blake2b, transactionSkeletonToJSON } from '../../utils';
import { logger } from '../../utils/logger';
import { getSmtRootAndProof } from '../omni-smt';
import { CkbTxHelper } from './base_generator';
import { SerializeRCData } from './generated/rc_lock';
import { ScriptType } from './indexer';
import { getMultisigLock } from './multisig/multisig_helper';
import { generateTypeIDScript } from './multisig/typeid';

export interface ContractsBin {
  bridgeLockscript: Buffer;
  recipientTypescript: Buffer;
}

export interface ContractsConfig {
  bridgeLock: ConfigItem;
  recipientType: ConfigItem;
}

export interface OwnerCellConfig {
  multisigLockscript: Script;
  ownerCellTypescript: Script;
}

export interface OmniLockCellConfig {
  omniMultisigLockscript: Script;
  adminCellTypescript: Script;
  smtRoot: string;
  smtProof: string;
}

export interface UpgradeParams {
  typeidArgs: string;
  bin: Buffer;
}

export class CkbDeployManager extends CkbTxHelper {
  constructor(ckbRpcUrl: string, ckbIndexerUrl: string) {
    super(ckbRpcUrl, ckbIndexerUrl);
  }

  async deployContractWithTypeID(contract: Buffer, privateKey: string): Promise<ConfigItem> {
    await this.indexer.waitForSync();
    let txSkeleton = TransactionSkeleton({ cellProvider: this.indexer });
    logger.debug(`txSkeleton: ${transactionSkeletonToJSON(txSkeleton)}`);
    // get from cells
    const fromAddress = generateSecp256k1Blake160Address(key.privateKeyToBlake160(privateKey));
    const fromLockscript = parseAddress(fromAddress);
    const fromCells = await this.getFromCells(fromLockscript);
    if (fromCells.length === 0) {
      throw new Error('no available cells found');
    }
    const firstInputCell: Cell = nonNullable(fromCells[0]);
    txSkeleton = await common.setupInputCell(txSkeleton, firstInputCell);
    // setupInputCell will put an output same with input, clear it
    txSkeleton = txSkeleton.update('outputs', (outputs) => {
      return outputs.clear();
    });
    // add output
    const firstInput = {
      previous_output: firstInputCell.out_point,
      since: '0x0',
    };
    const outputType = generateTypeIDScript(firstInput, `0x0`);
    const codeHash = utils.scriptToHash(<CKBComponents.Script>{
      codeHash: outputType.code_hash,
      hashType: outputType.hash_type,
      args: outputType.args,
    });
    const scriptOutput: Cell = {
      cell_output: {
        capacity: '0x0',
        lock: fromLockscript,
        type: outputType,
      },
      data: utils.bytesToHex(contract),
    };
    const scriptCapacity = minimalCellCapacity(scriptOutput);
    scriptOutput.cell_output.capacity = `0x${scriptCapacity.toString(16)}`;

    txSkeleton = txSkeleton.update('outputs', (outputs) => {
      return outputs.push(scriptOutput);
    });
    txSkeleton = await this.completeTx(txSkeleton, fromAddress, fromCells.slice(1));
    const hash = await this.SignAndSendTransaction(txSkeleton, privateKey);
    return {
      cellDep: {
        depType: 'code',
        outPoint: {
          txHash: hash,
          index: '0x0',
        },
      },
      script: {
        codeHash: codeHash,
        hashType: 'type',
      },
    };
  }

  async deployContracts(contracts: ContractsBin, privateKey: string): Promise<ContractsConfig> {
    await this.indexer.waitForSync();
    let txSkeleton = TransactionSkeleton({ cellProvider: this.indexer });
    logger.debug(`txSkeleton: ${transactionSkeletonToJSON(txSkeleton)}`);
    // get from cells
    const fromAddress = generateSecp256k1Blake160Address(key.privateKeyToBlake160(privateKey));
    const fromLockscript = parseAddress(fromAddress);
    const fromCells = await this.getFromCells(fromLockscript);
    if (fromCells.length === 0) {
      throw new Error('no available cells found');
    }
    const firstInputCell: Cell = nonNullable(fromCells[0]);
    txSkeleton = await common.setupInputCell(txSkeleton, firstInputCell);
    // setupInputCell will put an output same with input, clear it
    txSkeleton = txSkeleton.update('outputs', (outputs) => {
      return outputs.clear();
    });
    // add output
    const firstInput = {
      previous_output: firstInputCell.out_point,
      since: '0x0',
    };
    const bridgeLockscriptOutputType = generateTypeIDScript(firstInput, `0x0`);
    const bridgeLockscriptCodeHash = utils.scriptToHash(<CKBComponents.Script>{
      codeHash: bridgeLockscriptOutputType.code_hash,
      hashType: bridgeLockscriptOutputType.hash_type,
      args: bridgeLockscriptOutputType.args,
    });
    const bridgeLockscriptOutput: Cell = {
      cell_output: {
        capacity: '0x0',
        lock: fromLockscript,
        type: bridgeLockscriptOutputType,
      },
      data: utils.bytesToHex(contracts.bridgeLockscript),
    };
    const bridgeLockscriptCapacity = minimalCellCapacity(bridgeLockscriptOutput);
    bridgeLockscriptOutput.cell_output.capacity = `0x${bridgeLockscriptCapacity.toString(16)}`;

    const recipientTypescriptOutputType = generateTypeIDScript(firstInput, `0x1`);
    const recipientTypescriptCodeHash = utils.scriptToHash(<CKBComponents.Script>{
      codeHash: recipientTypescriptOutputType.code_hash,
      hashType: recipientTypescriptOutputType.hash_type,
      args: recipientTypescriptOutputType.args,
    });
    const recipientTypescriptOutput: Cell = {
      cell_output: {
        capacity: '0x0',
        lock: fromLockscript,
        type: recipientTypescriptOutputType,
      },
      data: utils.bytesToHex(contracts.recipientTypescript),
    };
    const recipientTypescriptCapacity = minimalCellCapacity(recipientTypescriptOutput);
    recipientTypescriptOutput.cell_output.capacity = `0x${recipientTypescriptCapacity.toString(16)}`;
    txSkeleton = txSkeleton.update('outputs', (outputs) => {
      return outputs.push(bridgeLockscriptOutput).push(recipientTypescriptOutput);
    });
    txSkeleton = await this.completeTx(txSkeleton, fromAddress, fromCells.slice(1));
    const hash = await this.SignAndSendTransaction(txSkeleton, privateKey);
    return {
      bridgeLock: {
        cellDep: {
          depType: 'code',
          outPoint: {
            txHash: hash,
            index: '0x0',
          },
        },
        script: {
          codeHash: bridgeLockscriptCodeHash,
          hashType: 'type',
        },
      },
      recipientType: {
        cellDep: {
          depType: 'code',
          outPoint: {
            txHash: hash,
            index: '0x1',
          },
        },
        script: {
          codeHash: recipientTypescriptCodeHash,
          hashType: 'type',
        },
      },
    };
  }

  // should only be called in dev net
  async deployScripts(scriptBins: Buffer[], privateKey: string): Promise<ConfigItem[]> {
    await this.indexer.waitForSync();
    let txSkeleton = TransactionSkeleton({ cellProvider: this.indexer });
    // get from cells
    const fromAddress = generateSecp256k1Blake160Address(key.privateKeyToBlake160(privateKey));
    const fromLockscript = parseAddress(fromAddress);
    // add output
    scriptBins.forEach((bin) => {
      const binOutput: Cell = {
        cell_output: {
          capacity: '0x0',
          lock: fromLockscript,
        },
        data: utils.bytesToHex(bin),
      };
      const binCellCapacity = minimalCellCapacity(binOutput);
      binOutput.cell_output.capacity = `0x${binCellCapacity.toString(16)}`;
      txSkeleton = txSkeleton.update('outputs', (outputs) => {
        return outputs.push(binOutput);
      });
    });

    txSkeleton = await this.completeTx(txSkeleton, fromAddress);
    const hash = await this.SignAndSendTransaction(txSkeleton, privateKey);
    // const sudtCodeHash = ;
    return scriptBins.map((bin, index) => ({
      cellDep: {
        depType: 'code',
        outPoint: {
          txHash: hash,
          index: `0x${index}`,
        },
      },
      script: {
        codeHash: utils.bytesToHex(blake2b(bin)),
        hashType: 'data',
      },
    }));
  }

  async SignAndSendTransaction(txSkeleton: TransactionSkeletonType, privateKey: string): Promise<string> {
    txSkeleton = await common.prepareSigningEntries(txSkeleton);
    const message = txSkeleton.get('signingEntries').get(0)!.message;
    const Sig = key.signRecoverable(message!, privateKey);
    const tx = sealTransaction(txSkeleton, [Sig]);
    const hash = await this.ckb.send_transaction(tx, 'passthrough');
    await this.waitUntilCommitted(hash);
    return hash;
  }

  async createOwnerCell(multisigItem: MultisigItem, privateKey: string): Promise<OwnerCellConfig> {
    await this.indexer.waitForSync();
    const multisigLockscript = getMultisigLock(multisigItem);
    const fromAddress = generateSecp256k1Blake160Address(key.privateKeyToBlake160(privateKey));
    const fromLockscript = parseAddress(fromAddress);
    let txSkeleton = TransactionSkeleton({ cellProvider: this.indexer });
    const fromCells = await this.getFromCells(fromLockscript);
    if (fromCells.length === 0) {
      throw new Error('no available cells found');
    }
    const firstInputCell: Cell = nonNullable(fromCells[0]);
    txSkeleton = await common.setupInputCell(txSkeleton, firstInputCell);
    // setupInputCell will put an output same with input, clear it
    txSkeleton = txSkeleton.update('outputs', (outputs) => {
      return outputs.clear();
    });
    // add owner cell
    const firstInput = {
      previous_output: firstInputCell.out_point,
      since: '0x0',
    };
    const ownerCellTypescript = generateTypeIDScript(firstInput, `0x0`);
    const ownerCell: Cell = {
      cell_output: {
        capacity: '0x0',
        lock: multisigLockscript,
        type: ownerCellTypescript,
      },
      data: '0x',
    };
    ownerCell.cell_output.capacity = `0x${minimalCellCapacity(ownerCell).toString(16)}`;
    // create an empty cell for the multi sig
    const multiCell: Cell = {
      cell_output: {
        capacity: '0x0',
        lock: multisigLockscript,
      },
      data: '0x',
    };
    multiCell.cell_output.capacity = `0x${minimalCellCapacity(multiCell).toString(16)}`;
    txSkeleton = txSkeleton.update('outputs', (outputs) => {
      return outputs.push(ownerCell).push(multiCell);
    });
    txSkeleton = await this.completeTx(txSkeleton, fromAddress, fromCells.slice(1));
    const _hash = await this.SignAndSendTransaction(txSkeleton, privateKey);
    return {
      multisigLockscript,
      ownerCellTypescript,
    };
  }

  async createOmniLockAdminCell(
    multisigItem: MultisigItem,
    privateKey: string,
    omniLockscriptConfig: ConfigItem['script'],
  ): Promise<OmniLockCellConfig> {
    await this.indexer.waitForSync();
    const fromAddress = generateSecp256k1Blake160Address(key.privateKeyToBlake160(privateKey));
    const fromLockscript = parseAddress(fromAddress);
    let txSkeleton = TransactionSkeleton({ cellProvider: this.indexer });
    const fromCells = await this.getFromCells(fromLockscript);
    if (fromCells.length === 0) {
      throw new Error('no available cells found');
    }
    const firstInputCell: Cell = nonNullable(fromCells[0]);
    txSkeleton = await common.setupInputCell(txSkeleton, firstInputCell);
    // setupInputCell will put an output same with input, clear it
    txSkeleton = txSkeleton.update('outputs', (outputs) => {
      return outputs.clear();
    });

    // add admin cell
    const firstInput = {
      previous_output: firstInputCell.out_point,
      since: '0x0',
    };
    const adminCellTypescript = generateTypeIDScript(firstInput, `0x0`);

    // omni lockscript of admin cell
    const typeIdHash = lumosUtils.computeScriptHash(adminCellTypescript);
    const omniLockArgs = `0x000000000000000000000000000000000000000000` + `01` + `${typeIdHash.substring(2)}`;
    const omniLockscript: Script = {
      code_hash: omniLockscriptConfig.codeHash,
      hash_type: omniLockscriptConfig.hashType,
      args: omniLockArgs,
    };

    // data of admin cell
    const { root, proof } = getSmtRootAndProof(multisigItem);
    const serializedRcData = SerializeRCData({
      type: 'RCRule',
      value: {
        smt_root: new Reader(root).toArrayBuffer(),
        flags: 2,
      },
    });
    const serializedRcDataHexString = new Reader(serializedRcData).serializeJson();

    const adminCell: Cell = {
      cell_output: {
        capacity: '0x0',
        lock: omniLockscript,
        type: adminCellTypescript,
      },
      data: serializedRcDataHexString,
    };
    adminCell.cell_output.capacity = `0x${minimalCellCapacity(adminCell).toString(16)}`;

    // create an empty omniMultisigCell
    const omniMultisigCell: Cell = {
      cell_output: {
        capacity: '0x0',
        lock: omniLockscript,
      },
      data: '0x',
    };
    omniMultisigCell.cell_output.capacity = `0x${minimalCellCapacity(omniMultisigCell).toString(16)}`;
    txSkeleton = txSkeleton.update('outputs', (outputs) => {
      return outputs.push(adminCell).push(omniMultisigCell);
    });
    txSkeleton = await this.completeTx(txSkeleton, fromAddress, fromCells.slice(1));
    const _hash = await this.SignAndSendTransaction(txSkeleton, privateKey);

    return {
      omniMultisigLockscript: omniLockscript,
      adminCellTypescript: adminCellTypescript,
      smtRoot: root,
      smtProof: proof,
    };
  }

  async upgradeCkbContract(upgrade: UpgradeParams[], privateKey: string): Promise<OutPoint[]> {
    await this.indexer.waitForSync();
    let txSkeleton = TransactionSkeleton({ cellProvider: this.indexer });
    // get from cells
    const fromAddress = generateSecp256k1Blake160Address(key.privateKeyToBlake160(privateKey));
    const fromLockscript = parseAddress(fromAddress);
    const typeidCodeHash = '0x00000000000000000000000000000000000000000000000000545950455f4944';
    for (const u of upgrade) {
      // get input
      const typeidScript = {
        code_hash: typeidCodeHash,
        hash_type: 'type' as HashType,
        args: u.typeidArgs,
      };
      const searchKey = {
        script: typeidScript,
        script_type: ScriptType.type,
      };
      const typeidInputs = await this.indexer.getCells(searchKey);
      asserts(typeidInputs.length === 1);
      txSkeleton = txSkeleton.update('inputs', (inputs) => {
        return inputs.concat(typeidInputs);
      });
      // add output
      const NewContractOutput: Cell = {
        cell_output: {
          capacity: '0x0',
          lock: fromLockscript,
          type: typeidScript,
        },
        data: utils.bytesToHex(u.bin),
      };
      const sudtCellCapacity = minimalCellCapacity(NewContractOutput);
      NewContractOutput.cell_output.capacity = `0x${sudtCellCapacity.toString(16)}`;
      txSkeleton = txSkeleton.update('outputs', (outputs) => {
        return outputs.push(NewContractOutput);
      });
    }
    txSkeleton = await this.completeTx(txSkeleton, fromAddress);
    const hash = await this.SignAndSendTransaction(txSkeleton, privateKey);
    const outpoints = upgrade.map((_u, i) => {
      return {
        tx_hash: hash,
        index: '0x' + i.toString(16),
      };
    });
    return outpoints;
  }
}
