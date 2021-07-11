import {Cell, Indexer, OutPoint, Script, Script as LumosScript} from '@ckb-lumos/base';
import * as utils from '@nervosnetwork/ckb-sdk-utils';
import {common, secp256k1Blake160} from '@ckb-lumos/common-scripts';
import { IndexerCollector } from './collector';
import CKB from "@nervosnetwork/ckb-sdk-core";
import {CkbIndexer, ScriptType, Terminator} from "./indexer";
import {RPC} from "@ckb-lumos/rpc";
import {minimalCellCapacity, TransactionSkeleton, TransactionSkeletonType} from "@ckb-lumos/helpers";
import {privateKeyToCkbAddress} from "../../utils";
import {Amount} from "@lay2/pw-core";
import {logger} from "../../utils/logger";
import {initLumosConfig} from "./init_lumos_config";
import {asserts, nonNullable} from "../../errors";
import {generateTypeIDScript} from "./multisig/typeid";
import CellOutput = CKBComponents.CellOutput;
import {AddressPrefix} from "@nervosnetwork/ckb-sdk-utils";

export interface ContractsBin {
    bridgeLockscript: Buffer,
    recipientTypescript: Buffer,
}

export class CkbOnChainManager {
    collector: IndexerCollector;
    indexer: CkbIndexer;
    ckb: CKB;

    _fromLockscript: Script | undefined = undefined;
    _secp256k1: DepCellInfo | undefined = undefined;

    constructor(private ckbRpcUrl: string, private ckbIndexerUrl: string, private privateKey: string, private prefix: AddressPrefix = AddressPrefix.Testnet) {
        initLumosConfig();
        this.ckb= new CKB(ckbRpcUrl);
        this.indexer = new CkbIndexer(ckbRpcUrl, ckbIndexerUrl);
        this.collector = new IndexerCollector(this.indexer);
    }

    async getSecp256k1Dep(): Promise<DepCellInfo> {
        if(this._secp256k1 !== undefined) {
            return this._secp256k1;
        } else {
            const { secp256k1Dep } = await this.ckb.loadDeps();
            asserts(secp256k1Dep);
            this._secp256k1 = secp256k1Dep;
            return secp256k1Dep!;
        }

    }

    async generateDeployContractsTx(contracts: ContractsBin) {

    }

    async getFromLockscript(): Promise<Script> {
        if(this._fromLockscript !== undefined) {
            return this._fromLockscript;
        }
        const pubkey = this.ckb.utils.privateKeyToPublicKey(this.privateKey);
        const args = `0x${this.ckb.utils.blake160(pubkey, 'hex')}`;
        const secp256k1Dep = await this.getSecp256k1Dep();
        const script = {
            code_hash: secp256k1Dep.codeHash,
            hash_type: secp256k1Dep.hashType,
            args,
        };
        this._fromLockscript = script;
        return script;
    }

    async getFromCells(): Promise<Cell[]> {
        const searchKey = {
            script: await this.getFromLockscript(),
            script_type: ScriptType.lock,
        }
        const terminator: Terminator = (index, c) => {
            const cell = c;
            if (cell.data.length / 2 - 1 > 0 || cell.cell_output.type !== undefined) {
                return { stop: false, push: false };
            } else {
                return { stop: false, push: true };
            }
        };
        const fromCells = await this.indexer.getCells(searchKey, terminator);
        logger.debug('fromCells', { fromCells });
        return fromCells;
    }

    // add capacity input, change output, pay fee
    async compeleteTx(txSkeleton: TransactionSkeletonType, fromLockscript: Script, feeRate: number = 1000): Promise<TransactionSkeletonType> {
        const changeOutput: Cell = {
            cell_output: {
                capacity: '0x0',
                lock: fromLockscript,
            },
            data: '0x',
        }
        const minimalChangeCellCapacity = minimalCellCapacity(changeOutput);
        return txSkeleton;
    }

    async deployContracts(contracts: ContractsBin) {
        await this.indexer.waitForSync();
        let txSkeleton = TransactionSkeleton({ cellProvider: this.indexer });
        // get from cells
        const fromCells = await this.getFromCells();
        if(fromCells.length === 0) {
            throw new Error('no available cells found');
        }
        const firstInput: Cell = nonNullable(fromCells[0]);
        txSkeleton = txSkeleton.update('inputs', (inputs) => {
            return inputs.push(firstInput);
        });
        // add output
        const fromLockscript = await this.getFromLockscript();
        const bridgeLockscriptOutput: Cell = {
            cell_output: {
                capacity: '0x0',
                lock: fromLockscript,
                type:  generateTypeIDScript(firstInput, `0x0`),
            },
            data: utils.bytesToHex(contracts.bridgeLockscript),
        }
        const recipientTypescriptOutput: Cell = {
            cell_output: {
                capacity: '0x0',
                lock: fromLockscript,
                type:  generateTypeIDScript(firstInput, `0x1`),
            },
            data: utils.bytesToHex(contracts.bridgeLockscript),
        }
        const bridgeLockscriptCapacity = minimalCellCapacity(bridgeLockscriptOutput);
        bridgeLockscriptOutput.cell_output.capacity = `0x${bridgeLockscriptCapacity.toString(16)}`;
        const recipientTypescriptCapacity = minimalCellCapacity(recipientTypescriptOutput);
        recipientTypescriptOutput.cell_output.capacity = `0x${recipientTypescriptCapacity.toString(16)}`;
        txSkeleton = txSkeleton.update('outputs', (outputs) => {
            return outputs.push(bridgeLockscriptOutput).push(recipientTypescriptOutput);
        });
        // add inputs
        // add additional 1 CKB for tx fee



        // logger.debug(`txSkeleton: ${JSON.stringify(txSkeleton, null, 2)}`);
        // const fromAddress = privateKeyToCkbAddress(this.privateKey, this.prefix);
        // const needCapacity = (BigInt(contracts.bridgeLockscript.length) + BigInt(contracts.recipientTypescript.length) + typeIdLength * 2n) * 10n ** 8n;
        // logger.debug(`txSkeleton: ${JSON.stringify(txSkeleton, null, 2)}`);
        // txSkeleton = await common.injectCapacity(txSkeleton, [fromAddress], needCapacity);
        // add change output
        // const changeOutput: Cell = {
        //     cell_output: {
        //         capacity: '0x0',
        //         lock: fromLockscript,
        //     },
        //     data: '0x',
        // }
        // txSkeleton = txSkeleton.update('outputs', (outputs) => {
        //     return outputs.push(changeOutput);
        // });
        // calculate output capacity
        // logger.debug(`infos`, { outputCapacity, secp256k1Dep });
        logger.debug(`txSkeleton: ${JSON.stringify(txSkeleton, null, 2)}`);
    }

    // should only be called in dev net
    async deploySudt() {

    }

    async createOwnerCell() {

    }

    async changeOwner() {

    }
}
