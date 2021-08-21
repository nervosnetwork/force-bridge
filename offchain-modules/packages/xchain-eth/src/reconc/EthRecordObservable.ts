import { EthLockRecord, EthUnlockRecord } from '@force-bridge/reconc';
import { EthAsset } from '@force-bridge/x/dist/ckb/model/asset';
import { parseLockLog } from '@force-bridge/x/dist/handlers/eth';
import { checkLock } from '@force-bridge/x/dist/xchain/eth/check';
import { ethers, Contract, providers } from 'ethers';
import { Observable, from } from 'rxjs';
import { concatMap, map, mergeMap, filter as rxFilter } from 'rxjs/operators';
import { ForceBridgeContract } from '..';
import { ForceBridge__factory } from '../generated/contract';
import { TypedEventFilter } from '../generated/contract/commons';

type Provider = providers.Provider;
type EventTypeOf<T extends keyof ForceBridgeContract['filters']> = Partial<
  ReturnType<ForceBridgeContract['filters'][T]> extends TypedEventFilter<unknown, infer EventType> ? EventType : never
>;

type BlockFilter = { fromBlock?: number | string; toBlock?: number | string };

export interface Options {
  /**
   * contract instance or contract address
   */
  contract: string | ForceBridgeContract;
  provider: Provider;
}

export class EthRecordObservable {
  provider: ethers.providers.Provider;
  contract: ForceBridgeContract;

  constructor(options: Options) {
    const { provider, contract } = options;
    this.provider = provider;
    this.contract = (
      contract instanceof Contract ? contract : new Contract(contract, ForceBridge__factory.createInterface(), provider)
    ) as ForceBridgeContract;
  }

  observeLockRecord(logFilter: EventTypeOf<'Locked'>, blockFilter: BlockFilter = {}): Observable<EthLockRecord> {
    const { provider, contract } = this;
    const contractLogFilter = contract.filters.Locked(logFilter.token, logFilter.sender);
    const { fromBlock = 0, toBlock } = blockFilter;

    return from(provider.getLogs({ ...contractLogFilter, fromBlock, toBlock })).pipe(
      mergeMap((res) => {
        return res.map((rawLog) => {
          const parsedLog = contract.interface.parseLog(rawLog);
          const logRes = parseLockLog(rawLog, parsedLog);
          return logRes;
        });
      }),
      rxFilter((logRes) => {
        return checkLock(logRes.amount, logRes.token, logRes.recipient, logRes.sudtExtraData) === '';
      }),
      map((logRes) => {
        return {
          mintId: `${logRes.txHash}-${logRes.logIndex}`,
          amount: logRes.amount.toString(),
          txId: logRes.txHash,
          sender: logRes.sender,
          token: logRes.token,
          recipient: logRes.recipient,
          sudtExtraData: logRes.sudtExtraData,
          blockNumber: logRes.blockNumber,
          blockHash: logRes.blockHash,
        };
      }),
    );
  }

  observeUnlockRecord(logFilter: EventTypeOf<'Unlocked'>, blockFilter: BlockFilter = {}): Observable<EthUnlockRecord> {
    const { contract, provider } = this;

    const contractLogFilter = contract.filters.Unlocked(logFilter.token, logFilter.recipient);
    const { fromBlock = 0, toBlock } = blockFilter;

    return from(provider.getLogs({ ...contractLogFilter, fromBlock, toBlock })).pipe(
      concatMap((x) => x),
      map((rawLog) => {
        const parsedLog = contract.interface.parseLog(rawLog);
        const { token, receivedAmount, ckbTxHash: fromTxId, recipient } = parsedLog.args;
        const txId = rawLog.transactionHash;
        const fee = new EthAsset(token).getBridgeFee('out');
        return {
          amount: String(receivedAmount),
          fromTxId,
          recipient,
          txId,
          fee,
          token,
          blockNumber: rawLog.blockNumber,
          blockHash: rawLog.blockHash,
        };
      }),
    );
  }
}
