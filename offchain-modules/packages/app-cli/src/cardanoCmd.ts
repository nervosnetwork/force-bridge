import { nonNullable } from '@force-bridge/x';
import { WalletServer, Seed, AddressWallet, ShelleyWallet } from 'cardano-wallet-js';
import commander from 'commander';

const WALLET_SERVER_URL = 'http://127.0.0.1:8090/v2';

export const cardanoCmd = new commander.Command('cardano');
cardanoCmd
  .command('lock')
  .requiredOption('-b, --bridgeAddr <Bridge Address>', 'Address of bridge on Cardano')
  .requiredOption('-a, --amount <amount>', 'amount of Ada to lock in lovelace')
  .requiredOption('-r, --recipient <recipient>', 'recipient address on ckb')
  .requiredOption('-w, --walletId <walletId>', 'cardano-wallet id')
  .requiredOption('-p, --passphrase <passphrase>', 'cardano-wallet passphrase')
  .option('--walletServerUrl <walletServerUrl>', 'Url of cardano-wallet server', WALLET_SERVER_URL)
  .action(doLock)
  .description('transfer Ada to the bridge');

async function doLock(opts: Record<string, string | boolean>) {
  const bridgeAddr = nonNullable(opts.bridgeAddr) as string;
  const amount = nonNullable(opts.amount) as string;
  const recipient = nonNullable(opts.recipient) as string;
  const walletId = nonNullable(opts.walletId) as string;
  const passphrase = nonNullable(opts.passphrase) as string;
  const walletServerUrl = nonNullable(opts.walletServerUrl || WALLET_SERVER_URL) as string;

  const lockAmount = Number(amount);

  if (Number.isNaN(lockAmount)) {
    console.log(`Amount specified is not valid: ${amount}`);
    return;
  }

  let userWallet;
  try {
    // Find wallet
    const walletServer = WalletServer.init(walletServerUrl);
    const wallets: ShelleyWallet[] = await walletServer.wallets();
    for (const wallet of wallets) {
      if (wallet.id == walletId) {
        userWallet = wallet;
      }
    }
    if (userWallet == undefined) {
      console.log(`Wallet with id '${walletId}' not found`);
      return;
    }
  } catch (e) {
    console.log(`Error: Please confirm that the cardano-wallet is available on: ${walletServerUrl}`);
  }

  try {
    // Do Lock
    const bridgeAddr_ = [new AddressWallet(bridgeAddr)];
    const metadata: any = { 0: recipient };
    console.log('Trying lock Ada:', amount);
    const transaction = await userWallet.sendPayment(passphrase, bridgeAddr_, [lockAmount], metadata);
    console.log('Successfully locked Ada, Tx details:', transaction);
  } catch (e) {
    console.log(
      `Error: Please confirm if the bridge address and passphrase are correct, and that there are sufficient funds in the account.`,
    );
    console.log(`Bridge Address: '${bridgeAddr}'`);
    console.log(`Amount (lovelace): '${lockAmount}'`);
  }
}
