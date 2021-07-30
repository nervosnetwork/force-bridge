// keep sending tx to bridge
import { TransactionResponse } from '@ethersproject/abstract-provider';
import { asyncSleep, getFromEnv, privateKeyToCkbAddress } from '@force-bridge/x/dist/utils';
import { initLog, logger } from '@force-bridge/x/dist/utils/logger';
import CKB from '@nervosnetwork/ckb-sdk-core';
import * as dotenv from 'dotenv';
import { ethers, providers, Wallet } from 'ethers';
import { JSONRPCClient } from 'json-rpc-2.0';
import * as lodash from 'lodash';
import fetch from 'node-fetch/index';
import { waitUntilCommitted } from './utils';
import { generateBurnTx, generateLockTx, prepareCkbAddresses } from './utils/eth_batch_test';
dotenv.config({ path: process.env.DOTENV_PATH || '.env' });

class TxSender {
  ckbAddresses: string[];
  client: JSONRPCClient;
  provider: providers.JsonRpcProvider;
  ethWallet: Wallet;
  ckb: CKB;
  ethAddress: string;

  constructor(
    public ethPrivateKey: string,
    public ckbPrivateKey: string,
    public ckbPrivateKeys: string[],
    public forceBridgeUrl: string,
    public ckbRpcUrl: string,
    public ckbIndexerUrl: string,
    public ethRpcUrl: string,
    public txIntervalMs: number = 1000,
  ) {
    this.ethAddress = ethers.utils.computeAddress(ethPrivateKey);
    this.ckbAddresses = ckbPrivateKeys.map((k) => privateKeyToCkbAddress(k));
    this.ckb = new CKB(ckbRpcUrl);
    const client = new JSONRPCClient((jsonRPCRequest) =>
      fetch(forceBridgeUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(jsonRPCRequest),
      }).then((response) => {
        if (response.status === 200) {
          // Use client.receive when you received a JSON-RPC response.
          return response.json().then((jsonRPCResponse) => client.receive(jsonRPCResponse));
        } else if (jsonRPCRequest.id !== undefined) {
          return Promise.reject(new Error(response.statusText));
        }
      }),
    );
    this.client = client;
    this.provider = new ethers.providers.JsonRpcProvider(ethRpcUrl);
    this.ethWallet = new ethers.Wallet(ethPrivateKey, this.provider);
  }

  async lock(
    ethTokenAddress: string,
    recipients: string[],
    lockAmount: string,
    wait = false,
    sendIntervalMs = 0,
  ): Promise<void> {
    const startNonce = await this.ethWallet.getTransactionCount();
    const txs: Array<TransactionResponse> = [];
    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      const signedLockTx = await generateLockTx(
        this.client,
        this.ethWallet,
        ethTokenAddress,
        startNonce + i,
        recipient,
        lockAmount,
        this.ethRpcUrl,
      );
      const lockTx = await this.provider.sendTransaction(signedLockTx);
      await asyncSleep(sendIntervalMs);
      txs.push(lockTx);
    }
    if (wait) {
      await Promise.all(txs.map((tx) => tx.wait()));
    }
  }

  async burn(
    ckbPrivateKey: string,
    recipient: string,
    ethTokenAddress: string,
    burnAmount: string,
    wait = false,
  ): Promise<string> {
    const ckbAddress = privateKeyToCkbAddress(ckbPrivateKey);
    const burnTx = await generateBurnTx(
      this.ckb,
      this.client,
      ethTokenAddress,
      ckbPrivateKey,
      ckbAddress,
      recipient,
      burnAmount,
    );
    const burnTxHash = await this.ckb.rpc.sendTransaction(burnTx);
    if (wait) {
      await waitUntilCommitted(this.ckb, burnTxHash, 120);
    }
    return burnTxHash;
  }

  async lockSender(): Promise<void> {
    for (;;) {
      const ethTokenAddress = '0x0000000000000000000000000000000000000000';
      const lockAmount = Math.floor(Math.random() * 200000 + 10000000000000).toString();
      await this.lock(ethTokenAddress, this.ckbAddresses, lockAmount, true, this.txIntervalMs);
    }
  }

  async burnSender(): Promise<void> {
    await prepareCkbAddresses(this.ckb, this.ckbPrivateKeys, this.ckbPrivateKey, this.ckbRpcUrl, this.ckbIndexerUrl);
    for (;;) {
      const ethTokenAddress = '0x0000000000000000000000000000000000000000';
      const recipient = this.ethAddress;
      const txs: Array<string> = [];
      await asyncSleep(30000);
      for (const ckbPrivateKey of lodash.shuffle(this.ckbPrivateKeys)) {
        try {
          const burnAmount = Math.floor(Math.random() * 200000 + 10000000000000).toString();
          const txHash = await this.burn(ckbPrivateKey, recipient, ethTokenAddress, burnAmount);
          await asyncSleep(this.txIntervalMs);
          txs.push(txHash);
        } catch (e) {
          logger.debug(`burn error: ${e.stack}`);
        }
      }
      logger.info('burn txs', txs);
      await Promise.all(txs.map((tx) => waitUntilCommitted(this.ckb, tx, 120)));
    }
  }

  async start(): Promise<void> {
    void this.lockSender();
    void this.burnSender();
  }
}

async function main() {
  initLog({ level: 'info', logFile: process.env.LOG_PATH });
  const FORCE_BRIDGE_URL = getFromEnv('FORCE_BRIDGE_URL');
  const CKB_RPC_URL = getFromEnv('CKB_RPC_URL');
  const ETH_RPC_URL = getFromEnv('ETH_RPC_URL');
  const CKB_INDEXER_URL = getFromEnv('CKB_INDEXER_URL');
  const CKB_TEST_PRIVKEY = getFromEnv('CKB_TEST_PRIVKEY');
  const ETH_TEST_PRIVKEY = getFromEnv('ETH_TEST_PRIVKEY');
  const CKB_PRIV_KEYS = getFromEnv('CKB_PRIV_KEYS');
  const ckbPrivKeys = lodash.split(CKB_PRIV_KEYS, ',');
  const TX_INTERNAL_MS = parseInt(getFromEnv('TX_INTERNAL_MS'));
  logger.info('start tx sender');
  const txSender = new TxSender(
    ETH_TEST_PRIVKEY,
    CKB_TEST_PRIVKEY,
    ckbPrivKeys,
    FORCE_BRIDGE_URL,
    CKB_RPC_URL,
    CKB_INDEXER_URL,
    ETH_RPC_URL,
    TX_INTERNAL_MS,
  );
  void txSender.start();
}

void main();
