import { Cell, Script } from '@ckb-lumos/base';
import { common } from '@ckb-lumos/common-scripts';
import { key } from '@ckb-lumos/hd';
import { parseAddress, TransactionSkeleton, TransactionSkeletonType, sealTransaction } from '@ckb-lumos/helpers';
import { nonNullable } from '../../errors';
import { transactionSkeletonToJSON } from '../../utils';
import { logger } from '../../utils/logger';
import { CkbTxHelper } from './base_generator';

export class CkbDapp extends CkbTxHelper {
  async getBalance(address: string): Promise<bigint> {
    await this.indexer.waitForSync();
    const userLock = parseAddress(address);
    return await this.collector.getBalance(userLock);
  }

  // transfer all CKB to recipientAddress
  async transfer(fromLockscript: Script, recipientAddress: string, fee = 1000n): Promise<TransactionSkeletonType> {
    const recipient = parseAddress(recipientAddress);
    await this.indexer.waitForSync();
    let txSkeleton = TransactionSkeleton({ cellProvider: this.indexer });
    const amount = await this.collector.getBalance(fromLockscript);
    const inputCells = await this.collector.getCellsByLockscriptAndCapacity(fromLockscript, amount);
    const firstInputCell: Cell = nonNullable(inputCells[0]);
    txSkeleton = await common.setupInputCell(txSkeleton, firstInputCell);
    // setupInputCell will put an output same with input, clear it
    txSkeleton = txSkeleton.update('outputs', (outputs) => {
      return outputs.clear();
    });
    txSkeleton = txSkeleton.update('inputs', (inputs) => {
      return inputs.concat(inputCells.slice(1));
    });
    // add output
    const sudtOutput: Cell = {
      cell_output: {
        capacity: `0x${(amount - fee).toString(16)}`,
        lock: recipient,
      },
      data: '0x',
    };
    txSkeleton = txSkeleton.update('outputs', (outputs) => {
      return outputs.push(sudtOutput);
    });
    logger.debug(`txSkeleton: ${transactionSkeletonToJSON(txSkeleton)}`);
    return txSkeleton;
  }

  async signAndSendTransaction(txSkeleton: TransactionSkeletonType, privateKey: string): Promise<string> {
    // freeze outputs
    txSkeleton = txSkeleton.update('fixedEntries', (fixedEntries) => {
      return fixedEntries.push({
        field: 'outputs',
        index: txSkeleton.get('outputs').size - 1,
      });
    });
    txSkeleton = await common.prepareSigningEntries(txSkeleton);
    const message = txSkeleton.get('signingEntries').get(0)!.message;
    const Sig = key.signRecoverable(message!, privateKey);
    const tx = sealTransaction(txSkeleton, [Sig]);
    const hash = await this.ckb.send_transaction(tx);
    await this.waitUntilCommitted(hash);
    return hash;
  }
}
