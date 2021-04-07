import commander from 'commander';
import { getSudtBalance, parseOptions } from './utils';
import { TronAsset } from '../../packages/ckb/model/asset';
import { Account } from '../../packages/ckb/model/accounts';
import { CkbTxGenerator } from '../../packages/ckb/tx-helper/generator';
import { IndexerCollector } from '../../packages/ckb/tx-helper/collector';
import { Amount } from '@lay2/pw-core';
import { ForceBridgeCore } from '../../packages/core';

const TronWeb = require('tronweb');

export const tronCmd = new commander.Command('tron');
tronCmd
  .command('lock')
  .requiredOption('-p, --privateKey', 'private key of locked address')
  .requiredOption('-a, --amount', 'amount to lock')
  .requiredOption('-r, recipient', 'recipient address on ckb')
  .option('-e, extra', 'extra data of sudt')
  .action(doLock)
  .description('lock asset on tron');

tronCmd
  .command('unlock')
  .requiredOption('-r, recipient', 'recipient address on tron')
  .requiredOption('-p, --privateKey', 'private key of unlock address on ckb')
  .requiredOption('-a, --amount', 'quantity of unlock')
  .action(doUnlock)
  .description('unlock asset on tron');

tronCmd
  .command('balanceOf')
  .option('-p, --privateKey', 'private key of locked address on ckb')
  .option('-addr, --address', 'address on tron')
  .action(doBalanceOf)
  .description('query balance of address on tron');

async function doLock(opts: any, command: any) {
  const options = parseOptions(opts, command);
  const privateKey = options.get('privateKey');
  const amount = options.get('amount');
  const recipient = options.get('recipient');
  const extra = options.get('extra');
  const memo = extra === undefined ? recipient : `${recipient},${extra}`;

  const tronWeb = new TronWeb({ fullHost: ForceBridgeCore.config.tron.tronGridUrl });
  const from = tronWeb.address.fromPrivateKey(privateKey);
  const from_hex = tronWeb.address.toHex(from);
  const to_hex = tronWeb.address.toHex(ForceBridgeCore.config.tron.committee.address);

  const unsigned_tx = await tronWeb.transactionBuilder.sendTrx(to_hex, amount, from_hex);
  const unsignedWithMemoTx = await tronWeb.transactionBuilder.addUpdateData(unsigned_tx, memo, 'utf8');
  const signed_tx = await tronWeb.trx.sign(unsignedWithMemoTx, privateKey);
  const broad_tx = await tronWeb.trx.broadcast(signed_tx);
  console.log(`Address:${from} locked:${amount} trx, recipient:${recipient} extra:${extra}`);
  console.log(broad_tx);
}

async function doUnlock(opts: any, command: any) {
  const options = parseOptions(opts, command);
  const recipientAddress = options.get('recipient');
  const amount = options.get('amount');
  const privateKey = options.get('privateKey');

  const account = new Account(privateKey);
  const ownLockHash = ForceBridgeCore.ckb.utils.scriptToHash(<CKBComponents.Script>await account.getLockscript());
  const generator = new CkbTxGenerator(ForceBridgeCore.ckb, new IndexerCollector(ForceBridgeCore.indexer));
  const burnTx = await generator.burn(
    await account.getLockscript(),
    recipientAddress,
    new TronAsset('trx', ownLockHash),
    new Amount(amount),
  );
  const signedTx = ForceBridgeCore.ckb.signTransaction(privateKey)(burnTx);
  const burnTxHash = await ForceBridgeCore.ckb.rpc.sendTransaction(signedTx);
  console.log(
    `Address:${account.address} unlock ${amount} trx, recipientAddress:${recipientAddress}, burnTxHash:${burnTxHash}`,
  );
}

async function doBalanceOf(opts: any, command: any) {
  const options = parseOptions(opts, command);
  const address = options.get('address');
  const privateKey = options.get('privateKey');
  if (!address && !privateKey) {
    console.log('address or privateKey are required');
    return;
  }
  if (address) {
    const tronWeb = new TronWeb({ fullHost: ForceBridgeCore.config.tron.tronGridUrl });
    const accountInfo = await tronWeb.trx.getAccount(address);
    console.log(accountInfo);
  }
  if (privateKey) {
    const account = new Account(privateKey);
    const ownLockHash = ForceBridgeCore.ckb.utils.scriptToHash(<CKBComponents.Script>await account.getLockscript());
    const asset = new TronAsset('trx', ownLockHash);
    const balance = await getSudtBalance(privateKey, asset);
    console.log(`BalanceOf address:${account.address} on ckb is ${balance}`);
  }
}
