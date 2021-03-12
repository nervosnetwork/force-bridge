import { BigNumber, ethers } from 'ethers';
import { EthDb } from '@force-bridge/db';
import { ForceBridgeCore } from '@force-bridge/core';
import { abi } from './abi/ForceBridge.json';
import { EthUnlock } from '@force-bridge/db/entity/EthUnlock';
import { logger } from '@force-bridge/utils/logger';
import { ChainType } from '@force-bridge/ckb/model/asset';

export class EthChain {
  protected readonly provider: ethers.providers.JsonRpcProvider;
  protected readonly bridgeContractAddr: string;
  protected readonly iface: ethers.utils.Interface;
  protected readonly bridge: ethers.Contract;
  protected readonly wallet: ethers.Wallet;

  constructor() {
    const config = ForceBridgeCore.config.eth;
    const url = config.rpcUrl;
    this.provider = new ethers.providers.JsonRpcProvider(url);
    this.bridgeContractAddr = config.contractAddress;
    this.iface = new ethers.utils.Interface(abi);
    this.wallet = new ethers.Wallet(config.privateKey, this.provider);
    logger.debug('address', this.wallet.address);
    this.bridge = new ethers.Contract(this.bridgeContractAddr, abi, this.provider).connect(this.wallet);
  }

  watchUnlockRecords(startHeight: number = 1, handleLogFunc) {
    const filter = {
      address: this.bridgeContractAddr,
      fromBlock: 'earliest',
      // topics: [ethers.utils.id('Locked(address,address,uint256,bytes,bytes)')],
    };
    // this.provider.resetEventsBlock(startHeight);
    this.provider.on(filter, async (log) => {
      logger.debug('log', log);
      const parsedLog = this.iface.parseLog(log);
      await handleLogFunc(log, parsedLog);
    });
  }

  async sendUnlockTxs(records: EthUnlock[]): Promise<any> {
    // const admin = await this.bridge.admin();
    // logger.debug('admin', admin);
    logger.debug('contract balance', await this.provider.getBalance(this.bridgeContractAddr));
    const params = records.map((r) => {
      return {
        token: r.asset,
        recipient: r.recipientAddress,
        amount: BigNumber.from(r.amount),
      };
    });
    logger.debug('sendUnlockTxs params', params);
    return await this.bridge.unlock(params);
  }
}
