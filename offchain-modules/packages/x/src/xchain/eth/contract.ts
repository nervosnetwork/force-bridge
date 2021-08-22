import { BigNumber, ethers } from 'ethers';
import { Interface } from 'ethers/lib/utils';
import { EthConfig, forceBridgeRole } from '../../config';
import { ForceBridgeCore } from '../../core';
import { IEthUnlock } from '../../db/model';
import { nonNullable } from '../../errors';
import { MultiSigMgr } from '../../multisig/multisig-mgr';
import { asyncSleep, retryPromise } from '../../utils';
import { logger } from '../../utils/logger';
import { abi } from './abi/ForceBridge.json';
import { buildSigRawData } from './utils';

export type Log = Parameters<Interface['parseLog']>[0] & {
  transactionHash: string;
  blockHash: string;
  blockNumber: number;
  logIndex: number;
};
export type ParsedLog = ReturnType<Interface['parseLog']>;
export type HandleLogFn = (log: Log, parsedLog: ParsedLog) => Promise<void> | void;

export const lockTopic = ethers.utils.id('Locked(address,address,uint256,bytes,bytes)');
export const unlockTopic = ethers.utils.id('Unlocked(address,address,address,uint256,bytes)');
export const WithdrawBridgeFeeTopic = '0xff';

export interface EthUnlockRecord {
  token: string;
  recipient: string;
  amount: string;
  ckbTxHash: string;
}

export class EthChain {
  public readonly role: forceBridgeRole;
  public readonly config: EthConfig;
  public readonly provider: ethers.providers.JsonRpcProvider;
  public readonly bridgeContractAddr: string;
  public readonly iface: ethers.utils.Interface;
  public readonly bridge: ethers.Contract;
  public readonly wallet: ethers.Wallet;
  public readonly multisigMgr: MultiSigMgr;

  constructor(role: forceBridgeRole) {
    const config = ForceBridgeCore.config.eth;
    const url = config.rpcUrl;
    this.role = role;
    this.config = config;
    this.provider = new ethers.providers.JsonRpcProvider(url);
    this.bridgeContractAddr = config.contractAddress;
    this.iface = new ethers.utils.Interface(abi);
    if (role === 'collector') {
      this.wallet = new ethers.Wallet(config.privateKey, this.provider);
      logger.debug('address', this.wallet.address);
      this.bridge = new ethers.Contract(this.bridgeContractAddr, abi, this.provider).connect(this.wallet);
      this.multisigMgr = new MultiSigMgr('ETH', this.config.multiSignHosts, this.config.multiSignThreshold);
    }
  }

  async getGasPrice(): Promise<BigNumber> {
    return this.provider.getGasPrice();
  }

  getMultiSigMgr(): MultiSigMgr {
    return this.multisigMgr;
  }

  watchLockEvents(startHeight = 1, handleLogFunc: HandleLogFn): void {
    const filter = {
      address: this.bridgeContractAddr,
      fromBlock: 'earliest',
      topics: [lockTopic],
    };
    // TODO resetEventsBlock is deprecated, replace with contract.queryFilter
    // <wangbing@cryptape.com>
    this.provider.resetEventsBlock(startHeight);
    this.provider.on(filter, async (log) => {
      const parsedLog = this.iface.parseLog(log);
      await handleLogFunc(log, parsedLog);
    });
  }

  watchUnlockEvents(startHeight = 1, handleLogFunc: HandleLogFn): void {
    const filter = {
      address: this.bridgeContractAddr,
      fromBlock: 'earliest',
      topics: [unlockTopic],
    };
    this.provider.resetEventsBlock(startHeight);
    this.provider.on(filter, async (log) => {
      const parsedLog = this.iface.parseLog(log);
      await handleLogFunc(log, parsedLog);
    });
  }

  async watchNewBlock(
    startHeight: number,
    handleBlockFunc: (newBlock: ethers.providers.Block) => void,
  ): Promise<never> {
    let currentHeight = startHeight + 1;
    for (;;) {
      await retryPromise(
        async () => {
          const block = await this.provider.getBlock(currentHeight);
          if (!block) return asyncSleep(5000);
          await handleBlockFunc(block);
          currentHeight++;
        },
        {
          onRejectedInterval: 3000,
          maxRetryTimes: Infinity,
          onRejected: (e: Error) => {
            if (isUnknownBlockError(e)) {
              logger.warn(`Eth watchNewBlock blockHeight:${currentHeight} error:${e.message}`);
            } else {
              logger.error(`Eth watchNewBlock blockHeight:${currentHeight} error:${e.stack}`);
            }
          },
        },
      );
    }
  }

  async getCurrentBlockNumber(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  async getBlock(blockTag: ethers.providers.BlockTag): Promise<ethers.providers.Block> {
    return this.provider.getBlock(blockTag);
  }

  async getLogs(fromBlock: ethers.providers.BlockTag, toBlock: ethers.providers.BlockTag): Promise<Log[]> {
    const logs: Log[] = await this.provider.getLogs({
      fromBlock: fromBlock,
      address: ForceBridgeCore.config.eth.contractAddress,
      toBlock: toBlock,
    });
    return logs;
  }

  async getLockLogs(
    fromBlock: ethers.providers.BlockTag,
    toBlock: ethers.providers.BlockTag,
  ): Promise<{ log; parsedLog }[]> {
    const logs = await this.provider.getLogs({
      fromBlock: fromBlock,
      address: ForceBridgeCore.config.eth.contractAddress,
      topics: [lockTopic],
      toBlock: toBlock,
    });
    return logs.map((log) => {
      const parsedLog = this.iface.parseLog(log);
      return { log, parsedLog };
    });
  }

  async getLockLogsByBlockHash(blockHash: string): Promise<{ log; parsedLog }[]> {
    const logs = await this.provider.getLogs({
      blockHash: blockHash,
      address: ForceBridgeCore.config.eth.contractAddress,
      topics: [lockTopic],
    });
    return logs.map((log) => {
      const parsedLog = this.iface.parseLog(log);
      return { log, parsedLog };
    });
  }

  async getUnlockLogs(
    fromBlock: ethers.providers.BlockTag,
    toBlock: ethers.providers.BlockTag,
  ): Promise<{ log; parsedLog }[]> {
    const logs = await this.provider.getLogs({
      fromBlock: fromBlock,
      address: ForceBridgeCore.config.eth.contractAddress,
      topics: [unlockTopic],
      toBlock: toBlock,
    });
    return logs.map((log) => {
      const parsedLog = this.iface.parseLog(log);
      return { log, parsedLog };
    });
  }

  async getUnlockLogsByBlockHash(blockHash: string): Promise<{ log; parsedLog }[]> {
    const logs = await this.provider.getLogs({
      blockHash: blockHash,
      address: ForceBridgeCore.config.eth.contractAddress,
      topics: [unlockTopic],
    });
    return logs.map((log) => {
      const parsedLog = this.iface.parseLog(log);
      return { log, parsedLog };
    });
  }

  async isLogForked(logs: Log[]): Promise<boolean> {
    let block: ethers.providers.Block | null = null;
    for (const log of logs) {
      if (block != null && log.blockHash === block.hash) {
        continue;
      }
      block = await this.provider.getBlock(log.blockNumber);
      if (block.hash != log.blockHash) {
        logger.error(
          `log fork occured in block ${log.blockNumber}, log.blockHash ${log.blockHash}, block.hash ${block.hash}`,
        );
        return true;
      }
    }
    return false;
  }

  async sendUnlockTxs(
    records: IEthUnlock[],
    gasPrice: BigNumber,
  ): Promise<ethers.providers.TransactionResponse | boolean | Error> {
    const maxTryTimes = 3;
    for (let tryTime = 0; ; tryTime++) {
      logger.debug('contract balance', await this.provider.getBalance(this.bridgeContractAddr));
      const params: EthUnlockRecord[] = records.map((r) => {
        return {
          token: r.asset,
          recipient: r.recipientAddress,
          amount: r.amount,
          ckbTxHash: r.ckbTxHash,
        };
      });
      try {
        const domainSeparator = await this.bridge.DOMAIN_SEPARATOR();
        const typeHash = await this.bridge.UNLOCK_TYPEHASH();
        const nonce: BigNumber = await this.bridge.latestUnlockNonce_();
        const signResult = await this.signUnlockRecords(domainSeparator, typeHash, params, nonce);
        if (typeof signResult === 'boolean' && (signResult as boolean)) {
          return true;
        }
        const signatures = signResult as string[];
        if (signatures.length < ForceBridgeCore.config.eth.multiSignThreshold) {
          return new Error(
            `sig number:${signatures.length} less than multiSignThreshold:${ForceBridgeCore.config.eth.multiSignThreshold}`,
          );
        }
        const signature = '0x' + signatures.join('');
        const collectorConfig = nonNullable(ForceBridgeCore.config.collector);
        const gasLimit =
          records.length === 1 ? collectorConfig.gasLimit : records.length * collectorConfig.batchGasLimit;
        const options = {
          gasPrice,
          gasLimit,
        };
        logger.debug(`send unlock options: ${JSON.stringify(options)}`);
        const dryRunRes = await this.bridge.callStatic.unlock(params, nonce, signature, options);
        logger.debug(`dryRunRes: ${JSON.stringify(dryRunRes, null, 2)}`);
        logger.info(`send unlockTx: ${JSON.stringify({ params, nonce, signature, options })}`);
        return await this.bridge.unlock(params, nonce, signature, options);
      } catch (e) {
        logger.error(`sendUnlockTxs error: ${JSON.stringify({ params, e })}`);
        if (tryTime >= maxTryTimes) {
          return e;
        }
        await asyncSleep(5000);
      }
    }
  }

  public async getUnlockMessageToSign(records: EthUnlockRecord[]): Promise<string> {
    const bridge = new ethers.Contract(this.bridgeContractAddr, abi, this.provider);
    const domainSeparator = await bridge.DOMAIN_SEPARATOR();
    const typeHash = await bridge.UNLOCK_TYPEHASH();
    const nonce: BigNumber = await bridge.latestUnlockNonce_();
    logger.info('sign with nonce: ', nonce.toString());
    return buildSigRawData(domainSeparator, typeHash, records, nonce);
  }

  public async sendWithdrawBridgeFeeTx(
    records: EthUnlockRecord[],
    signatures: string[],
  ): Promise<ethers.providers.TransactionResponse> {
    const nonce: BigNumber = await this.bridge.latestUnlockNonce_();
    logger.info('send withdraw fee tx with nonce: ', nonce.toString());
    return this.bridge.unlock(records, nonce, '0x' + signatures.join(''));
  }

  private async signUnlockRecords(
    domainSeparator: string,
    typeHash: string,
    records: EthUnlockRecord[],
    nonce: BigNumber,
  ): Promise<string[] | boolean> {
    const rawData = buildSigRawData(domainSeparator, typeHash, records, nonce);
    return await this.multisigMgr.collectSignatures({
      rawData: rawData,
      payload: {
        domainSeparator: domainSeparator,
        typeHash: typeHash,
        unlockRecords: records,
        nonce: nonce.toNumber(),
      },
    });
  }
}

function isUnknownBlockError(e: Error): boolean {
  return e.message.includes('eth_getLogs') && e.message.includes('unknown block');
}
