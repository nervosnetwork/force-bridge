import { EthLockRecord, EthMintRecord, EthBurnRecord, EthUnlockRecord } from '@force-bridge/reconc';
import { ChainType, EthAsset } from '@force-bridge/x/dist/ckb/model/asset';
import { NervosAsset } from '@force-bridge/x/dist/ckb/model/nervos-asset';
import { parseLockLog } from '@force-bridge/x/dist/handlers/eth';
import { fromHexString, uint8ArrayToString } from '@force-bridge/x/dist/utils';
import { ethers, Contract, providers } from 'ethers';
import { Observable, from } from 'rxjs';
import { concatMap, map, mergeMap } from 'rxjs/operators';
import { AssetManagerContract, ForceBridgeContract } from '..';
import { AssetManager__factory } from '../generated/contracts/AssetManager';
import { TypedEventFilter as AssetManagerTypedEventFilter } from '../generated/contracts/AssetManager/commons';
import { ForceBridge__factory } from '../generated/contracts/ForceBridge';
import { TypedEventFilter as ForceBridgeTypedEventFilter } from '../generated/contracts/ForceBridge/commons';

type Provider = providers.Provider;
type AssetManagerEventTypeOf<T extends keyof AssetManagerContract['filters']> = Partial<
  ReturnType<AssetManagerContract['filters'][T]> extends AssetManagerTypedEventFilter<unknown, infer EventType>
    ? EventType
    : never
>;

type ForceBridgeEventTypeOf<T extends keyof ForceBridgeContract['filters']> = Partial<
  ReturnType<ForceBridgeContract['filters'][T]> extends ForceBridgeTypedEventFilter<unknown, infer EventType>
    ? EventType
    : never
>;

type BlockFilter = { fromBlock?: number | string; toBlock?: number | string };

export interface Options {
  /**
   * contract instance or contract address
   */
  forceBridgeContract: string | ForceBridgeContract;
  assetManagerContract: string | AssetManagerContract;
  provider: Provider;
}

export class EthRecordObservable {
  provider: ethers.providers.Provider;
  forceBridgeContract: ForceBridgeContract;
  assetManagerContract: AssetManagerContract;

  constructor(options: Options) {
    const { provider, forceBridgeContract, assetManagerContract } = options;
    this.provider = provider;
    this.forceBridgeContract = (
      forceBridgeContract instanceof Contract
        ? forceBridgeContract
        : new Contract(forceBridgeContract, ForceBridge__factory.createInterface(), provider)
    ) as ForceBridgeContract;
    this.assetManagerContract = (
      assetManagerContract instanceof Contract
        ? assetManagerContract
        : new Contract(assetManagerContract, AssetManager__factory.createInterface(), provider)
    ) as AssetManagerContract;
  }

  observeLockRecord(
    logFilter: ForceBridgeEventTypeOf<'Locked'>,
    blockFilter: BlockFilter = {},
  ): Observable<EthLockRecord> {
    const { provider, forceBridgeContract } = this;
    const contractLogFilter = forceBridgeContract.filters.Locked(logFilter.token, logFilter.sender);
    const { fromBlock = 0, toBlock } = blockFilter;

    return from(provider.getLogs({ ...contractLogFilter, fromBlock, toBlock })).pipe(
      mergeMap((res) => {
        return res.map((rawLog) => {
          const parsedLog = forceBridgeContract.interface.parseLog(rawLog);
          const logRes = parseLockLog(rawLog, parsedLog);
          return logRes;
        });
      }),
      // rxFilter((logRes) => {
      //   return checkLock(logRes.amount, logRes.token, logRes.recipient, logRes.sudtExtraData) === '';
      // }),
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

  observeUnlockRecord(
    logFilter: ForceBridgeEventTypeOf<'Unlocked'>,
    blockFilter: BlockFilter = {},
  ): Observable<EthUnlockRecord> {
    const { forceBridgeContract, provider } = this;

    const contractLogFilter = forceBridgeContract.filters.Unlocked(logFilter.token, logFilter.recipient);
    const { fromBlock = 0, toBlock } = blockFilter;

    return from(provider.getLogs({ ...contractLogFilter, fromBlock, toBlock })).pipe(
      concatMap((x) => x),
      map((rawLog) => {
        const parsedLog = forceBridgeContract.interface.parseLog(rawLog);
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

  observeMintRecord(
    logFilter: AssetManagerEventTypeOf<'Mint'>,
    blockFilter: BlockFilter = {},
  ): Observable<EthMintRecord> {
    const { provider, assetManagerContract } = this;
    const contractLogFilter = assetManagerContract.filters.Mint(logFilter.assetId, logFilter.token, logFilter.to);
    const { fromBlock = 0, toBlock } = blockFilter;

    return from(provider.getLogs({ ...contractLogFilter, fromBlock, toBlock })).pipe(
      concatMap((x) => x),
      map((rawLog) => {
        const parsedLog = assetManagerContract.interface.parseLog(rawLog);
        const { assetId, token, to: recipient, amount: receivedAmount, lockId: fromTxId } = parsedLog.args;
        const txId = rawLog.transactionHash;
        const fee = NervosAsset.fromErc20Token(token).getBridgeFee('lock', ChainType.ETH);
        return {
          amount: String(receivedAmount),
          fromTxId,
          recipient,
          txId,
          fee,
          assetId,
          token,
          blockNumber: rawLog.blockNumber,
          blockHash: rawLog.blockHash,
        };
      }),
    );
  }

  observeBurnRecord(
    logFilter: AssetManagerEventTypeOf<'Burn'>,
    blockFilter: BlockFilter = {},
  ): Observable<EthBurnRecord> {
    const { provider, assetManagerContract } = this;
    const contractLogFilter = assetManagerContract.filters.Burn(logFilter.assetId, logFilter.token, logFilter.from);
    const { fromBlock = 0, toBlock } = blockFilter;

    return from(provider.getLogs({ ...contractLogFilter, fromBlock, toBlock })).pipe(
      mergeMap((res) => {
        return res.map((rawLog) => {
          const parsedLog = assetManagerContract.interface.parseLog(rawLog);
          return { rawLog, parsedLog };
        });
      }),
      map(({ rawLog, parsedLog }) => {
        const recipient = uint8ArrayToString(fromHexString(parsedLog.args.recipient));

        return {
          uniqueId: `${rawLog.transactionHash}-${rawLog.logIndex}`,
          txId: rawLog.transactionHash,
          amount: parsedLog.args.amount.toString(),
          sender: parsedLog.args.from,
          recipient,
          assetId: parsedLog.args.assetId,
          udtExtraData: parsedLog.args.udtExtraData,
          token: parsedLog.args.token,
          blockNumber: rawLog.blockNumber,
          blockHash: rawLog.blockHash,
        };
      }),
    );
  }
}
