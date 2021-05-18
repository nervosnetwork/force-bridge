import { BigNumber, ethers } from 'ethers';
import { ForceBridgeCore } from '@force-bridge/core';
import { abi } from './abi/ForceBridge.json';
import { EthUnlock } from '@force-bridge/db/entity/EthUnlock';
import { logger } from '@force-bridge/utils/logger';
import { EthConfig } from '@force-bridge/config';
import { asyncSleep } from '@force-bridge/utils';
import { MultiSigMgr } from '@force-bridge/multisig/multisig-mgr';
import { buildSigRawData } from '@force-bridge/xchain/eth/utils';

export const lockTopic = ethers.utils.id('Locked(address,address,uint256,bytes,bytes)');
const BlockBatchSize = 100;

export interface EthUnlockRecord {
  token: string;
  recipient: string;
  amount: BigNumber;
  ckbTxHash: string;
}

export class EthChain {
  protected readonly config: EthConfig;
  protected readonly provider: ethers.providers.JsonRpcProvider;
  protected readonly bridgeContractAddr: string;
  protected readonly iface: ethers.utils.Interface;
  protected readonly bridge: ethers.Contract;
  protected readonly wallet: ethers.Wallet;
  protected readonly multiSignKeys: string[];
  protected readonly multisigMgr: MultiSigMgr;

  constructor() {
    const config = ForceBridgeCore.config.eth;
    const url = config.rpcUrl;
    this.config = config;
    this.provider = new ethers.providers.JsonRpcProvider(url);
    this.bridgeContractAddr = config.contractAddress;
    this.iface = new ethers.utils.Interface(abi);
    this.wallet = new ethers.Wallet(config.privateKey, this.provider);
    logger.debug('address', this.wallet.address);
    this.bridge = new ethers.Contract(this.bridgeContractAddr, abi, this.provider).connect(this.wallet);
    this.multiSignKeys = config.multiSignKeys;
    this.multisigMgr = new MultiSigMgr('ETH', this.config.multiSignHosts, this.config.multiSignThreshold);
  }

  async watchLockEvents(startHeight = 1, handleLogFunc) {
    const confirmNumber = this.config.confirmNumber > 0 ? this.config.confirmNumber : 0;
    let currentBlockNumber = await this.provider.getBlockNumber();
    let maxConfirmedBlock = currentBlockNumber - confirmNumber;
    let fromBlock = startHeight;
    while (true) {
      try {
        if (fromBlock >= maxConfirmedBlock) {
          while (true) {
            currentBlockNumber = await this.provider.getBlockNumber();
            maxConfirmedBlock = currentBlockNumber - confirmNumber;
            if (fromBlock < maxConfirmedBlock) {
              break;
            }
            await asyncSleep(5000);
          }
        }
        let toBlock = fromBlock + BlockBatchSize;
        if (toBlock > maxConfirmedBlock) {
          toBlock = maxConfirmedBlock;
        }
        const logs = await this.provider.getLogs({
          fromBlock: fromBlock,
          address: this.bridgeContractAddr,
          topics: [ethers.utils.id('Locked(address,address,uint256,bytes,bytes)')],
          toBlock: toBlock,
        });
        logger.info(
          `Eth watchLockEvents from:${fromBlock} to:${toBlock} currentBlockNumber:${currentBlockNumber} confirmNumber:${confirmNumber} logs:${logs.length}`,
        );
        for (const log of logs) {
          logger.debug('log', log);
          const parsedLog = this.iface.parseLog(log);
          await handleLogFunc(log, parsedLog);
        }
        fromBlock = toBlock + 1;
      } catch (err) {
        logger.error('Eth watchLockEvents error:', err);
        await asyncSleep(3000);
      }
    }
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
