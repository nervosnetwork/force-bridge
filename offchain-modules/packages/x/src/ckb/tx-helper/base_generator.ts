import { Cell, Script, TransactionWithStatus } from '@ckb-lumos/base';
import { ScriptType, Terminator } from '@ckb-lumos/ckb-indexer/src/type';
import { common } from '@ckb-lumos/common-scripts';
import { getConfig, Config } from '@ckb-lumos/config-manager';
import { key } from '@ckb-lumos/hd';
import { minimalCellCapacity, parseAddress, TransactionSkeletonType } from '@ckb-lumos/helpers';
import { Indexer } from '@ckb-lumos/lumos';
import { RPC } from '@ckb-lumos/rpc';
import { asyncSleep, transactionSkeletonToJSON } from '../../utils';
import { logger } from '../../utils/logger';
import { IndexerCollector } from './collector';

// you have to initialize lumos config before use this generator
export class CkbTxHelper {
  ckbRpcUrl: string;
  ckbIndexerUrl: string;
  collector: IndexerCollector;
  indexer: Indexer;
  ckb: RPC;
  lumosConfig: Config;

  constructor(ckbRpcUrl: string, ckbIndexerUrl: string) {
    this.ckbRpcUrl = ckbRpcUrl;
    this.ckbIndexerUrl = ckbIndexerUrl;
    this.indexer = new Indexer(ckbRpcUrl, ckbIndexerUrl);
    this.ckb = new RPC(ckbRpcUrl);
    this.collector = new IndexerCollector(this.indexer);
    this.lumosConfig = getConfig();
    logger.debug('lumosConfig', this.lumosConfig);
  }

  generateSecp256k1Blake160Lockscript(privateKey: string): Script {
    const publicKey = key.privateToPublic(privateKey);
    const blake160 = key.publicKeyToBlake160(publicKey);
    return {
      codeHash: this.lumosConfig.SCRIPTS.SECP256K1_BLAKE160!.CODE_HASH,
      hashType: this.lumosConfig.SCRIPTS.SECP256K1_BLAKE160!.HASH_TYPE,
      args: blake160,
    };
  }

  async getFromCells(lockscript: Script): Promise<Cell[]> {
    const searchKey = {
      script: lockscript,
      scriptType: 'lock' as ScriptType,
    };
    const terminator: Terminator = (index, c) => {
      const cell = c;
      if (cell.data.length / 2 - 1 > 0 || cell.cellOutput.type) {
        return { stop: false, push: false };
      } else {
        return { stop: false, push: true };
      }
    };
    const fromCells = await this.indexer.getCells(searchKey, terminator);
    logger.debug(`fromCells: ${JSON.stringify(fromCells)}`);
    return fromCells.objects;
  }

  async calculateCapacityDiff(txSkeleton: TransactionSkeletonType): Promise<bigint> {
    const inputCapacity = txSkeleton
      .get('inputs')
      .map((c) => BigInt(c.cellOutput.capacity))
      .reduce((a, b) => a + b, 0n);
    const outputCapacity = txSkeleton
      .get('outputs')
      .map((c) => BigInt(c.cellOutput.capacity))
      .reduce((a, b) => a + b, 0n);
    return inputCapacity - outputCapacity;
  }

  // add capacity input, change output, pay fee
  async completeTx(
    txSkeleton: TransactionSkeletonType,
    fromAddress: string,
    fromCells?: Cell[],
    feeRate = 1200n,
  ): Promise<TransactionSkeletonType> {
    logger.debug(`txSkeleton: ${transactionSkeletonToJSON(txSkeleton)}`);
    // freeze outputs
    txSkeleton = txSkeleton.update('fixedEntries', (fixedEntries) => {
      return fixedEntries.push({
        field: 'outputs',
        index: txSkeleton.get('outputs').size - 1,
      });
    });
    // add change output
    const fromLockscript = parseAddress(fromAddress);
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
    const capacityDiff = await this.calculateCapacityDiff(txSkeleton);
    logger.debug('injectCapacity params', {
      fromAddress,
      capacityDiff,
    });
    if (capacityDiff < 0) {
      txSkeleton = await common.injectCapacity(txSkeleton, [fromAddress], -capacityDiff, undefined, undefined, {
        enableDeductCapacity: false,
      });
    } else {
      txSkeleton.update('outputs', (outputs) => {
        const before = BigInt(changeOutput.cellOutput.capacity);
        const after = before + capacityDiff;
        changeOutput.cellOutput.capacity = `0x${after.toString(16)}`;
        return outputs.set(outputs.size - 1, changeOutput);
      });
    }
    logger.debug(`txSkeleton: ${transactionSkeletonToJSON(txSkeleton)}`);
    logger.debug(`capacity diff: ${await this.calculateCapacityDiff(txSkeleton)}`);
    txSkeleton = await common.payFeeByFeeRate(txSkeleton, [fromAddress], feeRate);
    logger.debug(`txSkeleton: ${transactionSkeletonToJSON(txSkeleton)}`);
    logger.debug(`final fee: ${await this.calculateCapacityDiff(txSkeleton)}`);
    await asyncSleep(1000);
    return txSkeleton;
  }

  async waitUntilCommitted(txHash: string, timeout = 120): Promise<TransactionWithStatus | null> {
    let waitTime = 0;
    for (;;) {
      const txStatus = await this.ckb.getTransaction(txHash);
      if (txStatus !== null) {
        logger.debug(`tx ${txHash}, status: ${txStatus.txStatus.status}, index: ${waitTime}`);
        if (txStatus.txStatus.status === 'committed') {
          return txStatus;
        }
      } else {
        throw new Error(`wait for ${txHash} until committed failed with null txStatus`);
      }
      waitTime += 1;
      if (waitTime > timeout) {
        logger.warn('waitUntilCommitted timeout', { txHash, timeout, txStatus });
        throw new Error(`wait for ${txHash} until committed timeout after ${timeout} seconds`);
      }
      await asyncSleep(1000);
    }
  }
}
