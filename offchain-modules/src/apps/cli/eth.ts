import commander from 'commander';
import { getSudtBalance, parseOptions } from './utils';
import { ethers } from 'ethers';
import { abi } from '../../packages/xchain/eth/abi/ForceBridge.json';
import { EthAsset } from '../../packages/ckb/model/asset';
import { Account } from '../../packages/ckb/model/accounts';
import { CkbTxGenerator } from '../../packages/ckb/tx-helper/generator';
import { IndexerCollector } from '../../packages/ckb/tx-helper/collector';
import { Amount } from '@lay2/pw-core';
import { ForceBridgeCore } from '../../packages/core';

export const ethCmd = new commander.Command('eth');
ethCmd
  .command('lock')
  .requiredOption('-p, --privateKey', 'private key of locked account')
  .requiredOption('-a, --amount', 'amount to lock')
  .requiredOption('-r, recipient', 'recipient address on ckb')
  .option('-e, extra', 'extra data of sudt')
  .action(doLock)
  .description('lock asset on eth');

ethCmd
  .command('unlock')
  .requiredOption('-r, recipient', 'recipient address on eth')
  .requiredOption('-p, --privateKey', 'private key of unlock address on ckb')
  .requiredOption('-a, --amount', 'amount of unlock')
  .action(doUnlock)
  .description('unlock asset on eth');

ethCmd
  .command('balanceOf')
  .option('-p, --privateKey', 'private key of locked address on ckb')
  .option('-addr, --address', 'address on eth')
  .action(doBalanceOf)
  .description('query balance of address on eth');

async function doLock(opts: any, command: any) {
  const options = parseOptions(opts, command);
  const privateKey = options.get('privateKey');
  const amount = options.get('amount');
  const recipient = options.get('recipient');
  const extra = options.get('extra');
  const memo = extra === undefined ? recipient : `${recipient},${extra}`;

  const provider = new ethers.providers.JsonRpcProvider(ForceBridgeCore.config.eth.rpcUrl);
  const bridge = new ethers.Contract(ForceBridgeCore.config.eth.contractAddress, abi, provider);
  const wallet = new ethers.Wallet(privateKey, provider);
  const bridgeWithSigner = bridge.connect(wallet);
  const fragments = memo.split(',');
  const recipientLockscript = '0x' + Buffer.from(fragments[0]).toString('hex');
  const sudtExtraData = fragments[1] !== undefined ? '0x' + Buffer.from(fragments[1]).toString('hex') : '0x';
  const lockRes = await bridgeWithSigner.lockETH(recipientLockscript, sudtExtraData, {
    value: ethers.utils.parseEther(amount),
  });
  console.log(`Address:${lockRes.from} locked:${amount} eth, recipient:${recipient} extra:${extra}`);
  console.log(lockRes);
}

async function doUnlock(opts: any, command: any) {
  const options = parseOptions(opts, command);
  const recipientAddress = options.get('recipient');
  const privateKey = options.get('privateKey');
  const amount = options.get('amount');
  const account = new Account(privateKey);
  const generator = new CkbTxGenerator(ForceBridgeCore.ckb, new IndexerCollector(ForceBridgeCore.indexer));
  const ownLockHash = ForceBridgeCore.ckb.utils.scriptToHash(<CKBComponents.Script>await account.getLockscript());

  const burnTx = await generator.burn(
    await account.getLockscript(),
    recipientAddress,
    new EthAsset('0x0000000000000000000000000000000000000000', ownLockHash),
    new Amount(ethers.utils.parseEther('0.1').toString()),
  );

  const signedTx = ForceBridgeCore.ckb.signTransaction(privateKey)(burnTx);
  const burnTxHash = await ForceBridgeCore.ckb.rpc.sendTransaction(signedTx);
  console.log(
    `Address:${account.address} unlock ${amount} eth, recipientAddress:${recipientAddress}, burnTxHash:${burnTxHash}`,
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
    const provider = new ethers.providers.JsonRpcProvider(ForceBridgeCore.config.eth.rpcUrl);
    const balanceOf = await provider.getBalance(address);
    console.log(`BalanceOf address:${address} on ETH is ${balanceOf}`);
  }
  if (privateKey) {
    const account = new Account(privateKey);
    const ownLockHash = ForceBridgeCore.ckb.utils.scriptToHash(<CKBComponents.Script>await account.getLockscript());
    const asset = new EthAsset('0x0000000000000000000000000000000000000000', ownLockHash);
    const balance = await getSudtBalance(privateKey, asset);
    console.log(`BalanceOf address:${account.address} on ckb is ${balance}`);
  }
}
