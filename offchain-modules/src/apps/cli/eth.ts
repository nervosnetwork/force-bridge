import commander from 'commander';
import { getSudtBalance, parseOptions, waitUnlockTxCompleted } from './utils';
import { ethers } from 'ethers';
import { abi } from '../../packages/xchain/eth/abi/ForceBridge.json';
import { EthAsset } from '../../packages/ckb/model/asset';
import { Account } from '../../packages/ckb/model/accounts';
import { CkbTxGenerator } from '../../packages/ckb/tx-helper/generator';
import { IndexerCollector } from '../../packages/ckb/tx-helper/collector';
import { Amount } from '@lay2/pw-core';
import { ForceBridgeCore } from '../../packages/core';
import { formatEther } from 'ethers/lib/utils';

export const ethCmd = new commander.Command('eth');
ethCmd
  .command('lock')
  .requiredOption('-p, --privateKey', 'private key of locked account')
  .requiredOption('-a, --amount', 'amount to lock')
  .requiredOption('-r, --recipient', 'recipient address on ckb')
  .option('-w, --wait', 'whether wait for transaction confirmed')
  .option('-e, extra', 'extra data of sudt')
  .action(doLock)
  .description('lock asset on eth');

ethCmd
  .command('unlock')
  .requiredOption('-r, recipient', 'recipient address on eth')
  .requiredOption('-p, --privateKey', 'private key of unlock address on ckb')
  .requiredOption('-a, --amount', 'amount of unlock')
  .option('-w, --wait', 'whether wait for transaction confirmed')
  .action(doUnlock)
  .description('unlock asset on eth');

ethCmd
  .command('balanceOf')
  .requiredOption('-addr, --address', 'address on eth or ckb')
  .option('-o, --origin', 'whether query balance on eth')
  .action(doBalanceOf)
  .description('query balance of address on eth or ckb');

async function doLock(opts: any, command: any) {
  const options = parseOptions(opts, command);
  const privateKey = options.get('privateKey');
  const amount = options.get('amount');
  const recipient = options.get('recipient');
  const extra = options.get('extra');

  const provider = new ethers.providers.JsonRpcProvider(ForceBridgeCore.config.eth.rpcUrl);
  const bridge = new ethers.Contract(ForceBridgeCore.config.eth.contractAddress, abi, provider);
  const wallet = new ethers.Wallet(privateKey, provider);
  const bridgeWithSigner = bridge.connect(wallet);

  const recipientLockscript = '0x' + Buffer.from(recipient).toString('hex');
  const sudtExtraData = extra !== undefined ? '0x' + Buffer.from(extra).toString('hex') : '0x';
  const lockRes = await bridgeWithSigner.lockETH(recipientLockscript, sudtExtraData, {
    value: ethers.utils.parseEther(amount),
  });
  console.log(`Address:${lockRes.from} locked:${amount} eth, recipient:${recipient} extra:${extra}`);
  console.log(lockRes);
  if (opts.wait) {
    console.log('Waiting for transaction confirmed...');
    await lockRes.wait(3);
    console.log('Lock success.');
  }
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
    new Amount(ethers.utils.parseEther(amount).toString(), 0),
  );

  const signedTx = ForceBridgeCore.ckb.signTransaction(privateKey)(burnTx);
  const burnTxHash = await ForceBridgeCore.ckb.rpc.sendTransaction(signedTx);
  console.log(
    `Address:${account.address} unlock ${amount} eth, recipientAddress:${recipientAddress}, burnTxHash:${burnTxHash}`,
  );
  if (opts.wait) {
    await waitUnlockTxCompleted(burnTxHash);
  }
}

async function doBalanceOf(opts: any, command: any) {
  const options = parseOptions(opts, command);
  const address = options.get('address');

  if (opts.origin) {
    const provider = new ethers.providers.JsonRpcProvider(ForceBridgeCore.config.eth.rpcUrl);
    const balanceOf = await provider.getBalance(address);
    console.log(`BalanceOf address:${address} on ETH is ${balanceOf}`);
    return;
  }

  const ownLockHash = ForceBridgeCore.ckb.utils.scriptToHash(
    <CKBComponents.Script>ForceBridgeCore.ckb.utils.addressToScript(address),
  );
  const asset = new EthAsset('0x0000000000000000000000000000000000000000', ownLockHash);
  const balance = await getSudtBalance(address, asset);
  console.log(`BalanceOf address:${address} on ckb is ${formatEther(balance.toString(0))}`);
}
