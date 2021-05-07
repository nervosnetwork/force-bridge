import { BigNumber, ethers } from 'ethers';
import { ForceBridgeCore } from '@force-bridge/core';
import { abi } from './abi/ForceBridge.json';
import { EthUnlock } from '@force-bridge/db/entity/EthUnlock';
import { logger } from '@force-bridge/utils/logger';
import { JSONRPCClient } from 'json-rpc-2.0';
import fetch from 'node-fetch/index';
import { EthConfig } from '@force-bridge/config';
import { asyncSleep } from '@force-bridge/utils';

const BlockBatchSize = 100;

export class EthChain {
  protected readonly config: EthConfig;
  protected readonly provider: ethers.providers.JsonRpcProvider;
  protected readonly bridgeContractAddr: string;
  protected readonly iface: ethers.utils.Interface;
  protected readonly bridge: ethers.Contract;
  protected readonly wallet: ethers.Wallet;
  protected readonly multiSignKeys: string[];

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
    // const admin = await this.bridge.admin();
    // logger.debug('admin', admin);
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

  private async collectEthSignature(host: string, payload): Promise<string> {
    const client = new JSONRPCClient((jsonRPCRequest) =>
      fetch(host, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(jsonRPCRequest),
      }).then((response) => {
        if (response.status === 200) {
          return response.json().then((jsonRPCResponse) => client.receive(jsonRPCResponse));
        } else if (jsonRPCRequest.id !== undefined) {
          return Promise.reject(new Error(response.statusText));
        }
      }),
    );
    const signMessage = await client.request('signEthTx', payload);
    console.log('collectEthSignature', signMessage);
    return signMessage;
  }

  private async signUnlockRecords(domainSeparator: string, typeHash: string, records, nonce) {
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
    const payload = {
      msg: msg,
    };
    let signatures = '0x';
    let number = 0;
    for (const host of ForceBridgeCore.config.eth.multiSignHosts) {
      if (number == ForceBridgeCore.config.eth.multiSignThreshold) {
        break;
      }
      const signature = await this.collectEthSignature(host, payload);
      if (signature != undefined) {
        signatures += signature;
        number++;
      }
    }
    return signatures;
  }
}
