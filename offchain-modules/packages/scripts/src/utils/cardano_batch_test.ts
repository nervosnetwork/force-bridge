import { asyncSleep } from '@force-bridge/x/dist/utils';
import { logger } from '@force-bridge/x/dist/utils/logger';
import { JSONRPCClient } from 'json-rpc-2.0';
import fetch from 'node-fetch/index';
import CKB from '@nervosnetwork/ckb-sdk-core';
import { prepareCkbPrivateKeys, prepareCkbAddresses, burn } from './eth_batch_test';
import * as CardanoWasm from '@emurgo/cardano-serialization-lib-nodejs';
import { WalletServer, Seed, AddressWallet, ShelleyWallet } from 'cardano-wallet-js';

export async function cardanoBatchTest(
  ckbPrivateKey: string,
  WALLET_SERVER_URL: string,
  ckbNodeUrl: string,
  ckbIndexerUrl: string,
  forceBridgeUrl: string,
  adaForceBridgeAddr: string,
  adaWalletMnemonic: string,
  batchNum = 100,
  lockAmount = 2000000,
  burnAmount = '1990000',
): Promise<void> {
  logger.info('adaBatchTest start!');
  const ckb = new CKB(ckbNodeUrl);

  const client = new JSONRPCClient((jsonRPCRequest) =>
    fetch(forceBridgeUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(jsonRPCRequest),
      // id: 1,
    }).then((response) => {
      if (response.status === 200) {
        // Use client.receive when you received a JSON-RPC response.
        return response.json().then((jsonRPCResponse) => client.receive(jsonRPCResponse));
      } else if (jsonRPCRequest.id !== undefined) {
        return Promise.reject(new Error(response.statusText));
      }
    }),
                                  );

  logger.info('adaBatchTest adaWallet created');

  const ckbPrivs = await prepareCkbPrivateKeys(batchNum);
  const ckbAddresses = await prepareCkbAddresses(ckb, ckbPrivs, ckbPrivateKey, ckbNodeUrl, ckbIndexerUrl);

  let passphrase = 'user_wallet_passphrase';
  let adaWallet = await getUserWallet(WALLET_SERVER_URL, adaWalletMnemonic, passphrase);

  const lockTxs = await lock(client, adaWallet, passphrase, ckbAddresses, adaForceBridgeAddr, lockAmount, 10*1000);
  // await check(client, lockTxs, ckbAddresses, batchNum, adaTokenAddress);

  await asyncSleep(120000);
  let adaAddress = 'addr_test1qzr32f6d58c3fud3u8zsqj6gnnmu06f3rkgt9z6qpa05prc4a05fk35vqa77wdtvrllelfa3rk0tn8g9kgvhks8983nsrhgv65';
  const burnTxs = await burn(ckb, client, ckbPrivs, ckbAddresses, adaAddress, 'ada', burnAmount, 'Cardano', 0);
  // await check(client, burnTxs, ckbAddresses, batchNum, adaTokenAddress);
  logger.info('adaBatchTest pass!');
}

async function getUserWallet(WALLET_SERVER_URL: string, adaWalletMnemonic: string, passphrase: string): Promise<ShelleyWallet> {
  let walletServer = WalletServer.init(WALLET_SERVER_URL);
  let wallets: ShelleyWallet[] = await walletServer.wallets();
  let walletName = 'user_test_wallet';
  for (let wallet of wallets) {
    if (wallet.name == walletName) {
      // return immediately;
      return wallet;
    }
  }
  let userWallet = await walletServer.createOrRestoreShelleyWallet(walletName, Seed.toMnemonicList(adaWalletMnemonic), passphrase);
  // Allow the wallet to sync up
  await asyncSleep(10000);
  return userWallet;
}

async function lock(
  client: JSONRPCClient,
  adaWallet: ShelleyWallet,
  passphrase: string,
  recipients: Array<string>,
  adaForceBridgeAddr: string,
  lockAmount: number,
  intervalMs = 0,
): Promise<Array<string>> {
  logger.info('adaBatchTest lock start');
  const batchNum = recipients.length;
  const lockTxHashes = new Array<string>();

  let bridgeAddr = [new AddressWallet(adaForceBridgeAddr)];
  for (let i = 0; i < batchNum; i++) {
    let metadata: any = {0: recipients[i]};
    logger.info('adaBatchTest sending payment:', i);
    let transaction = await adaWallet.sendPayment(passphrase, bridgeAddr, [lockAmount], metadata);
    lockTxHashes.push(transaction.id);
    await asyncSleep(intervalMs);
  }

  logger.info('lock txs', lockTxHashes);
  return lockTxHashes;
}

