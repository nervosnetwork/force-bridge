import commander from 'commander';
import { JsSignatureProvider } from 'eosjs/dist/eosjs-jssig';
import { EosChain } from '../../packages/xchain/eos/eosChain';
import { getSudtBalance, parseOptions } from './utils';
import { EosAsset } from '../../packages/ckb/model/asset';
import { Account } from '../../packages/ckb/model/accounts';
import { CkbTxGenerator } from '../../packages/ckb/tx-helper/generator';
import { IndexerCollector } from '../../packages/ckb/tx-helper/collector';
import { Amount } from '@lay2/pw-core';
import { ForceBridgeCore } from '../../packages/core';

export const eosCmd = new commander.Command('eos');
eosCmd
  .command('lock')
  .requiredOption('-acc, --account', 'account to lock')
  .requiredOption('-p, --privateKey', 'private key of locked account on eos')
  .requiredOption('-a, --amount', 'amount to lock')
  .requiredOption('-r, recipient', 'recipient address on ckb')
  .option('-e, extra', 'extra data of sudt')
  .action(doLock)
  .description('lock asset on eos');

eosCmd
  .command('unlock')
  .requiredOption('-r, recipient', 'recipient account on eos')
  .requiredOption('-p, --privateKey', 'private key of unlock address on ckb')
  .requiredOption('-a, --amount', 'amount of unlock')
  .action(doUnlock)
  .description('unlock asset on eos');

eosCmd
  .command('balanceOf')
  .option('-acc, --account', 'account on eos to query')
  .option('-v, --detail', 'show detail information of balance on eos')
  .option('-p, --privateKey', 'private key of locked address on ckb')
  .action(doBalanceOf)
  .description('query balance of account');

async function doLock(opts: any, command: any) {
  const options = parseOptions(opts, command);
  const account = options.get('account');
  const privateKey = options.get('privateKey');
  const amount = options.get('amount');
  const recipient = options.get('recipient');
  const extra = options.get('extra');
  const memo = extra === undefined ? recipient : `${recipient},${extra}`;

  const chain = createEosChain(ForceBridgeCore.config.eos.rpcUrl, privateKey);
  const txRes = await chain.transfer(
    account,
    ForceBridgeCore.config.eos.bridgerAccount,
    'active',
    amount + ' EOS',
    memo,
    'eosio.token',
    {
      broadcast: true,
      blocksBehind: 3,
      expireSeconds: 30,
    },
  );
  console.log(`Account:${account} locked:${amount} eos, recipient:${recipient} extra:${extra}`);
  console.log(txRes);
}

async function doUnlock(opts: any, command: any) {
  const options = parseOptions(opts, command);
  const recipientAddress = options.get('recipient');
  const amount = options.get('amount');
  const privateKey = options.get('privateKey');

  const account = new Account(privateKey);
  const generator = new CkbTxGenerator(ForceBridgeCore.ckb, new IndexerCollector(ForceBridgeCore.indexer));
  const ownLockHash = ForceBridgeCore.ckb.utils.scriptToHash(<CKBComponents.Script>await account.getLockscript());
  const burnTx = await generator.burn(
    await account.getLockscript(),
    recipientAddress,
    new EosAsset('EOS', ownLockHash),
    new Amount(amount),
  );
  const signedTx = ForceBridgeCore.ckb.signTransaction(privateKey)(burnTx);
  const burnTxHash = await ForceBridgeCore.ckb.rpc.sendTransaction(signedTx);
  console.log(
    `Address:${account.address} unlock ${amount} eos, recipientAddress:${recipientAddress}, burnTxHash:${burnTxHash}`,
  );
}

async function doBalanceOf(opts: any, command: any) {
  const options = parseOptions(opts, command);
  const account = options.get('account');
  const privateKey = options.get('privateKey');
  if (!account && !privateKey) {
    console.log('account or privateKey are required');
    return;
  }
  if (account) {
    const chain = createEosChain(ForceBridgeCore.config.eos.rpcUrl, null);
    const accountInfo = await chain.getAccountInfo(account);
    if (opts.detail) {
      console.log(accountInfo);
      return;
    }
    const balance = {
      account_name: accountInfo.account_name,
      head_block_num: accountInfo.head_block_num,
      core_liquid_balance: accountInfo.core_liquid_balance,
      ram_quota: accountInfo.ram_quota,
      net_weight: accountInfo.net_weight,
      cpu_weight: accountInfo.cpu_weight,
    };
    console.log(balance);
  }
  if (privateKey) {
    const account = new Account(privateKey);
    const ownLockHash = ForceBridgeCore.ckb.utils.scriptToHash(<CKBComponents.Script>await account.getLockscript());
    const asset = new EosAsset('EOS', ownLockHash);
    const balance = await getSudtBalance(privateKey, asset);
    console.log(`BalanceOf address:${account.address} on ckb is ${balance}`);
  }
}

function createEosChain(rpcUrl: string, privateKeys: string): EosChain {
  let signatureProvider: JsSignatureProvider;
  if (privateKeys) {
    signatureProvider = new JsSignatureProvider(privateKeys.split(','));
  }
  return new EosChain(rpcUrl, signatureProvider);
}
