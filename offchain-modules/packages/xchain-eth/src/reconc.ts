import { FromRecord, Reconciler, Reconciliation, ToRecord } from '@force-bridge/reconc';
import { ethers } from 'ethers';
import { ForceBridge as ForceBridgeContract } from './generated/contract';
import { EthDb } from './local';

export class EthLockReconciler implements Reconciler {
  constructor(
    readonly account: string,
    readonly asset: string,
    private readonly provider: ethers.providers.Provider,
    private readonly contract: ForceBridgeContract,
    private readonly db: EthDb,
  ) {}

  async getFromRecordsByOnChainState(): Promise<FromRecord[]> {
    const contractLogFilter = this.contract.filters.Locked(this.asset, this.account);

    const logs = await this.provider.getLogs({ ...contractLogFilter, fromBlock: 0 });
    return logs.map((rawLog) => {
      const parsedLog = this.contract.interface.parseLog(rawLog);
      return { amount: parsedLog.args.lockedAmount.toString(), txId: rawLog.transactionHash };
    });
  }

  async getToRecordsByLocalState(): Promise<ToRecord[]> {
    const records = await this.db.getLockRecordsByXChainAddress(this.account, this.asset);

    return records.map<ToRecord>((record) => ({
      txId: record.mint_hash,
      amount: record.mint_amount,
      recipient: record.recipient,
      // TODO
      fee: '0',
    }));
  }

  async fetchReconciliation(): Promise<Reconciliation> {
    const from: FromRecord[] = await this.getFromRecordsByOnChainState();
    const to: ToRecord[] = await this.getToRecordsByLocalState();

    return new Reconciliation(from, to);
  }
}

export class EthUnlockReconciler implements Reconciler {
  constructor(readonly account: string, readonly asset: string) {}

  async fetchReconciliation(): Promise<Reconciliation> {
    // TODO fetch and parse burn transaction on ckb node
    const from: FromRecord[] = [];
    // TODO fetch records from {@link CkbBurn}
    const to: ToRecord[] = [];

    return new Reconciliation(from, to);
  }
}

/**
 * @example
 * const provider = new ethers.providers.JsonRpcProvider(url);
 * const contract = new ethers.Contract(contractAddress, abi) as unknown) as ForceBridgeContract;
 * const ethDb = new EthDb(conn);
 *
 * const builder = new EthReconcilerBuilder(provider, contract, ethDb);
 *
 * const reconc = await builder.buildLockReconciler(lockAccountAddress, erc20Address)
 *                              .fetchReconciliation();
 * reconc.checkBalanced();
 */
export class EthReconcilerBuilder {
  constructor(
    private provider: ethers.providers.Provider,
    private contract: ForceBridgeContract,
    private ethDb: EthDb,
  ) {}

  buildLockReconciler(accountAddress: string, assetAddress: string): EthLockReconciler {
    return new EthLockReconciler(accountAddress, assetAddress, this.provider, this.contract, this.ethDb);
  }

  createUnlockReconciler(): EthUnlockReconciler {
    throw new Error('unimplemented method');
  }
}
