import { ecsign, toRpcSig } from 'ethereumjs-util';
import { BigNumber, ethers } from 'ethers';
import { EthConfig, forceBridgeRole } from '../../config';
import { ForceBridgeCore } from '../../core';
import { EthUnlock } from '../../db/entity/EthUnlock';
import { MultiSigMgr } from '../../multisig/multisig-mgr';
import { asyncSleep } from '../../utils';
import { logger } from '../../utils/logger';
import { abi } from './abi/ForceBridge.json';
import { buildSigRawData } from './utils';

export const lockTopic = ethers.utils.id('Locked(address,address,uint256,bytes,bytes)');

export interface EthUnlockRecord {
  token: string;
  recipient: string;
  amount: BigNumber;
  ckbTxHash: string;
}

export class EthChain {
  protected readonly role: forceBridgeRole;
  protected readonly config: EthConfig;
  protected readonly provider: ethers.providers.JsonRpcProvider;
  protected readonly bridgeContractAddr: string;
  protected readonly iface: ethers.utils.Interface;
  protected readonly bridge: ethers.Contract;
  protected readonly wallet: ethers.Wallet;
  protected readonly multiSignKeys: string[];
  protected readonly multisigMgr: MultiSigMgr;

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
      this.multiSignKeys = config.multiSignKeys;
      this.multisigMgr = new MultiSigMgr('ETH', this.config.multiSignHosts, this.config.multiSignThreshold);
    }
  }

  watchLockEvents(startHeight = 1, handleLogFunc) {
    const filter = {
      address: this.bridgeContractAddr,
      fromBlock: 'earliest',
      topics: [lockTopic],
    };
    this.provider.resetEventsBlock(startHeight);
    this.provider.on(filter, async (log) => {
      const parsedLog = this.iface.parseLog(log);
      await handleLogFunc(log, parsedLog);
    });
  }

  async watchNewBlock(startHeight: number, handleBlockFunc) {
    for (let height = startHeight + 1; ; ) {
      const block = await this.provider.getBlock(height);
      if (!block) {
        await asyncSleep(5 * 1000);
        continue;
      }
      await handleBlockFunc(block);
      height++;
    }
  }

  async getCurrentBlockNumber(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  async getBlock(blockTag: ethers.providers.BlockTag): Promise<ethers.providers.Block> {
    return this.provider.getBlock(blockTag);
  }

  async getLogs(
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

  async sendUnlockTxs(records: EthUnlock[]): Promise<any> {
    logger.debug('contract balance', await this.provider.getBalance(this.bridgeContractAddr));
    const params: EthUnlockRecord[] = records.map((r) => {
      return {
        token: r.asset,
        recipient: r.recipientAddress,
        amount: BigNumber.from(r.amount),
        ckbTxHash: r.ckbTxHash,
      };
    });
    const domainSeparator = await this.bridge.DOMAIN_SEPARATOR();
    const typeHash = await this.bridge.UNLOCK_TYPEHASH();
    const nonce: number = await this.bridge.latestUnlockNonce_();
    const signatures = this.signUnlockRecords(domainSeparator, typeHash, params, nonce);
    logger.debug('sendUnlockTxs params', params);
    return this.bridge.unlock(params, nonce, signatures);
  }

  private async signUnlockRecords(
    domainSeparator: string,
    typeHash: string,
    records: EthUnlockRecord[],
    nonce: number,
  ) {
    const rawData = buildSigRawData(domainSeparator, typeHash, records, nonce);
    const sigs = await this.multisigMgr.collectSignatures({
      rawData: rawData,
      payload: {
        domainSeparator: domainSeparator,
        typeHash: typeHash,
        unlockRecords: records,
        nonce: nonce,
      },
    });
    return '0x' + sigs.join('');
  }
}
