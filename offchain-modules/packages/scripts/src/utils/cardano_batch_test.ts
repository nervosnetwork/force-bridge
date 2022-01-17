import * as CardanoWasm from '@emurgo/cardano-serialization-lib-nodejs';
import { asyncSleep } from '@force-bridge/x/dist/utils';
import { logger } from '@force-bridge/x/dist/utils/logger';
import CKB from '@nervosnetwork/ckb-sdk-core';
import { WalletServer, Seed, AddressWallet, ShelleyWallet } from 'cardano-wallet-js';
import { JSONRPCClient } from 'json-rpc-2.0';
import fetch from 'node-fetch/index';
import { prepareCkbPrivateKeys, prepareCkbAddresses, burn, checkTx } from './eth_batch_test';

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
  burnAmount = 1990000,
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

  const passphrase = 'user_wallet_passphrase';
  const adaWallet = await getUserWallet(WALLET_SERVER_URL, adaWalletMnemonic, passphrase);

  const lockTxs = await lock(client, adaWallet, passphrase, ckbAddresses, adaForceBridgeAddr, lockAmount, 30000);
  await check(client, lockTxs, ckbAddresses, batchNum);

  await adaWallet.refresh();
  const ununsedAddresses = await adaWallet.getUnusedAddresses();
  const adaAddress = ununsedAddresses[0].address;

  const postLockUserBalance = adaWallet.getAvailableBalance();

  const burnTxs = await burn(
    ckb,
    client,
    ckbPrivs,
    ckbAddresses,
    adaAddress,
    'ada',
    burnAmount.toString(),
    'Cardano',
    0,
  );
  await check(client, burnTxs, ckbAddresses, batchNum);

  for (let i = 0; i < 5; i++) {
    // Allow the wallet to sync
    await adaWallet.refresh();
    const postUnlockUserBalance = adaWallet.getAvailableBalance();
    const fundsReceived = postUnlockUserBalance - postLockUserBalance;
    const expectedFundsUnlocked = burnAmount * batchNum;
    if (fundsReceived == expectedFundsUnlocked) {
      break;
    } else if (i < 5) {
      await asyncSleep(30000);
      continue;
    } else {
      throw new Error(`fundsReceived '${fundsReceived}' does not match expected '${expectedFundsUnlocked}'`);
    }
  }
  logger.info('adaBatchTest pass!');
  return;
}

async function getUserWallet(
  WALLET_SERVER_URL: string,
  adaWalletMnemonic: string,
  passphrase: string,
): Promise<ShelleyWallet> {
  const walletServer = WalletServer.init(WALLET_SERVER_URL);
  const wallets: ShelleyWallet[] = await walletServer.wallets();
  const walletName = 'user_test_wallet';
  for (const wallet of wallets) {
    if (wallet.name == walletName) {
      // return immediately;
      return wallet;
    }
  }
  const userWallet = await walletServer.createOrRestoreShelleyWallet(
    walletName,
    Seed.toMnemonicList(adaWalletMnemonic),
    passphrase,
  );
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

  const bridgeAddr = [new AddressWallet(adaForceBridgeAddr)];
  for (let i = 0; i < batchNum; i++) {
    await adaWallet.refresh();
    const metadata: any = { 0: recipients[i] };
    logger.info('adaBatchTest sending payment:', i);
    const transaction = await adaWallet.sendPayment(passphrase, bridgeAddr, [lockAmount], metadata);
    lockTxHashes.push(transaction.id);
    await asyncSleep(intervalMs);
  }

  logger.info('lock txs', lockTxHashes);
  return lockTxHashes;
}

async function check(
  client: JSONRPCClient,
  txHashes: Array<string>,
  addresses: Array<string>,
  batchNum: number,
): Promise<void> {
  for (let i = 0; i < batchNum; i++) {
    await checkTx(client, 'ada', txHashes[i], addresses[i], 'Cardano');
  }
}
