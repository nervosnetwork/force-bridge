import commander from 'commander';
import { JsSignatureProvider } from 'eosjs/dist/eosjs-jssig';
import { EosChain } from '../../packages/xchain/eos/eosChain';
import { getSudtBalance, parseOptions, waitUnlockTxCompleted } from './utils';
import { EosAsset, TronAsset } from '../../packages/ckb/model/asset';
import { Account } from '../../packages/ckb/model/accounts';
import { CkbTxGenerator } from '../../packages/ckb/tx-helper/generator';
import { IndexerCollector } from '../../packages/ckb/tx-helper/collector';
import { Amount } from '@lay2/pw-core';
import { ForceBridgeCore } from '../../packages/core';
import { asyncSleep } from '@force-bridge/utils';
import { EosAssetAmount } from '@force-bridge/xchain/eos/utils';

export const eosCmd = new commander.Command('eos');
eosCmd
  .command('lock')
  .requiredOption('-acc, --account', 'account to lock')
  .requiredOption('-p, --privateKey', 'private key of locked account on eos')
  .requiredOption('-a, --amount', 'amount to lock, eg: 0.0001 EOS')
  .requiredOption('-r, --recipient', 'recipient address on ckb')
  .option('-e, --extra', 'extra data of sudt')
  .option('-w, --wait', 'whether waiting for transaction become irreversible')
  .action(doLock)
  .description('lock asset on eos');

eosCmd
  .command('unlock')
  .requiredOption('-r, recipient', 'recipient account on eos')
  .requiredOption('-p, --privateKey', 'private key of unlock address on ckb')
  .requiredOption('-a, --amount', 'amount of unlock, eg: 0.0001 EOS')
  .option('-w, --wait', 'whether waiting for transaction confirmed')
  .action(doUnlock)
  .description('unlock asset on eos');

eosCmd
  .command('balanceOf')
  .option('-addr, --address', 'address on ckb')
  .option('-acc, --account', 'account on eos to query')
  .option('-s, --asset', 'asset symbol', 'EOS')
  .option('-v, --detail', 'show detail information of balance on eos')
  .action(doBalanceOf)
  .description('query balance of account on eos or ckb');

async function doLock(
  opts: { account: boolean; privateKey: boolean; amount: boolean; recipient: boolean; extra?: boolean; wait?: boolean },
  command: commander.Command,
) {
  const options = parseOptions(opts, command);
  const account = options.get('account');
  const privateKey = options.get('privateKey');
  const amount = options.get('amount');
  const recipient = options.get('recipient');
  const extra = options.get('extra');
  const memo = extra === undefined ? recipient : `${recipient},${extra}`;
  const assetAmount = EosAssetAmount.assetAmountFromQuantity(amount);
  if (!assetAmount.Asset) {
    assetAmount.Asset = 'EOS';
  }

  const chain = createEosChain(ForceBridgeCore.config.eos.rpcUrl, privateKey);
  const txRes = await chain.transfer(
    account,
    ForceBridgeCore.config.eos.bridgerAccount,
    'active',
    assetAmount.toString(),
    memo,
    'eosio.token',
    {
      broadcast: true,
      blocksBehind: 3,
      expireSeconds: 30,
    },
  );
  console.log(`Account:${account} locked:${assetAmount.toString()}, recipient:${recipient} extra:${extra}`);
  console.log(txRes);

  if (opts.wait) {
    if (!('processed' in txRes) || !('transaction_id' in txRes)) {
      return;
    }
    console.log('Waiting for transaction executed...');
    while (true) {
      await asyncSleep(5000);
      const txInfo = await chain.getTransaction(txRes.transaction_id);
      console.log(`TxStatus:${txInfo.trx.receipt.status}`);
      if (txInfo.trx.receipt.status === 'executed') {
        break;
      }
    }
    console.log('Lock success.');
  }
}

async function doUnlock(
  opts: { recipient: boolean; privateKey: boolean; amount: boolean; wait?: boolean },
  command: commander.Command,
) {
  const options = parseOptions(opts, command);
  const recipientAddress = options.get('recipient');
  const amount = options.get('amount');
  const privateKey = options.get('privateKey');
  const assetAmount = EosAssetAmount.assetAmountFromQuantity(amount);
  if (!assetAmount.Asset) {
    assetAmount.Asset = 'EOS';
  }

  const account = new Account(privateKey);
  const generator = new CkbTxGenerator(ForceBridgeCore.ckb, new IndexerCollector(ForceBridgeCore.ckbIndexer));
  const burnTx = await generator.burn(
    await account.getLockscript(),
    recipientAddress,
    new EosAsset(assetAmount.Asset, ForceBridgeCore.config.ckb.ownerLockHash),
    new Amount(assetAmount.Amount, assetAmount.Precision),
  );
  const signedTx = ForceBridgeCore.ckb.signTransaction(privateKey)(burnTx);
  const burnTxHash = await ForceBridgeCore.ckb.rpc.sendTransaction(signedTx);
  console.log(
    `Address:${
      account.address
    } unlock ${assetAmount.toString()}, recipientAddress:${recipientAddress}, burnTxHash:${burnTxHash}`,
  );
  if (opts.wait) {
    await waitUnlockTxCompleted(burnTxHash);
  }
}

async function doBalanceOf(
  opts: { address?: boolean; account?: boolean; detail?: boolean },
  command: commander.Command,
) {
  const options = parseOptions(opts, command);
  const account = options.get('account');
  const address = options.get('address');
  if (!account && !address) {
    console.log('account or address are required');
    return;
  }
  const token = !options.get('asset') ? 'EOS' : options.get('asset');

  const chain = createEosChain(ForceBridgeCore.config.eos.rpcUrl, null);
  if (account) {
    const balance = await chain.getCurrencyBalance(account, token);
    console.log(balance);
  }
  if (address) {
    const asset = new EosAsset(token, ForceBridgeCore.config.ckb.ownerLockHash);
    const balance = await getSudtBalance(address, asset);
    console.log(
      `BalanceOf address:${address} on ckb is ${balance.toString(await chain.getCurrencyPrecision(token))} ${token}`,
    );
  }
}

function createEosChain(rpcUrl: string, privateKeys: string): EosChain {
  let signatureProvider: JsSignatureProvider;
  if (privateKeys) {
    signatureProvider = new JsSignatureProvider(privateKeys.split(','));
  }
  return new EosChain(rpcUrl, signatureProvider);
}
