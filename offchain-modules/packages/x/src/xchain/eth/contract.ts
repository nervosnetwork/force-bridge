import { ecsign, toRpcSig } from 'ethereumjs-util';
import { BigNumber, ethers } from 'ethers';
import { EthConfig, forceBridgeRole } from '../../config';
import { ForceBridgeCore } from '../../core';
import { EthUnlock } from '../../db/entity/EthUnlock';
import { asyncSleep } from '../../utils';
import { logger } from '../../utils/logger';
import { abi } from './abi/ForceBridge.json';

const lockTopic = ethers.utils.id('Locked(address,address,uint256,bytes,bytes)');

export class EthChain {
  protected readonly role: forceBridgeRole;
  protected readonly config: EthConfig;
  protected readonly provider: ethers.providers.JsonRpcProvider;
  protected readonly bridgeContractAddr: string;
  protected readonly iface: ethers.utils.Interface;
  protected readonly bridge: ethers.Contract;
  protected readonly wallet: ethers.Wallet;
  protected readonly multiSignKeys: string[];

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
      this.bridge = new ethers.Contract(this.bridgeContractAddr, abi, this.provider).connect(this.wallet);
      this.multiSignKeys = config.multiSignKeys;
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
    const params = records.map((r) => {
      return {
        token: r.asset,
        recipient: r.recipientAddress,
        amount: BigNumber.from(r.amount),
        ckbTxHash: r.ckbTxHash,
      };
    });
    const domainSeparator = await this.bridge.DOMAIN_SEPARATOR();
    const typeHash = await this.bridge.UNLOCK_TYPEHASH();
    const nonce = await this.bridge.latestUnlockNonce_();
    const signatures = this.signUnlockRecords(domainSeparator, typeHash, params, nonce);
    logger.debug('sendUnlockTxs params', params);
    return this.bridge.unlock(params, nonce, signatures);
  }

  private signUnlockRecords(domainSeparator: string, typeHash: string, records, nonce) {
    const msg = ethers.utils.keccak256(
      ethers.utils.solidityPack(
        ['bytes1', 'bytes1', 'bytes32', 'bytes32'],
        [
          '0x19',
          '0x01',
          domainSeparator,
          ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(
              [
                'bytes32',
                ethers.utils.ParamType.from({
                  components: [
                    { name: 'token', type: 'address' },
                    { name: 'recipient', type: 'address' },
                    { name: 'amount', type: 'uint256' },
                    { name: 'ckbTxHash', type: 'bytes' },
                  ],
                  name: 'records',
                  type: 'tuple[]',
                }),
                'uint256',
              ],
              [typeHash, records, nonce],
            ),
          ),
        ],
      ),
    );

    let signatures = '0x';
    for (let i = 0; i < this.multiSignKeys.length; i++) {
      const wallet = new ethers.Wallet(this.multiSignKeys[i], this.provider);
      const { v, r, s } = ecsign(Buffer.from(msg.slice(2), 'hex'), Buffer.from(wallet.privateKey.slice(2), 'hex'));
      const sigHex = toRpcSig(v, r, s);
      signatures += sigHex.slice(2);
    }
    return signatures;
  }
}
