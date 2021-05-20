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

const ETH_ASSET = '0x0000000000000000000000000000000000000000';

export const ethCmd = new commander.Command('eth');
ethCmd
  .command('lock')
  .requiredOption('-p, --privateKey', 'private key of locked account')
  .requiredOption('-a, --amount', 'amount to lock')
  .requiredOption('-r, --recipient', 'recipient address on ckb')
  .option('-s, --asset', 'contract address of asset', ETH_ASSET)
  .option('-w, --wait', 'whether wait for transaction confirmed')
  .option('-e, --extra', 'extra data of sudt')
  .action(doLock)
  .description('lock asset on eth');

ethCmd
  .command('unlock')
  .requiredOption('-r, --recipient', 'recipient address on eth')
  .requiredOption('-p, --privateKey', 'private key of unlock address on ckb')
  .requiredOption('-a, --amount', 'amount of unlock')
  .option('-s, --asset', 'contract address of asset', ETH_ASSET)
  .option('-w, --wait', 'whether wait for transaction confirmed')
  .action(doUnlock)
  .description('unlock asset on eth');

ethCmd
  .command('balanceOf')
  .requiredOption('-addr, --address', 'address on eth or ckb')
  .option('-s, --asset', 'contract address of asset', ETH_ASSET)
  .option('-o, --origin', 'whether query balance on eth')
  .action(doBalanceOf)
  .description('query balance of address on eth or ckb');

async function doLock(
  opts: { privateKey: boolean; amount: boolean; recipient: boolean; asset?: boolean; wait?: boolean; extra?: boolean },
  command: commander.Command,
) {
  const options = parseOptions(opts, command);
  const privateKey = options.get('privateKey');
  const amount = options.get('amount');
  const recipient = options.get('recipient');
  const extra = options.get('extra');
  const asset = options.get('asset');

  const provider = new ethers.providers.JsonRpcProvider(ForceBridgeCore.config.eth.rpcUrl);
  const bridge = new ethers.Contract(ForceBridgeCore.config.eth.contractAddress, abi, provider);
  const wallet = new ethers.Wallet(privateKey, provider);
  const bridgeWithSigner = bridge.connect(wallet);
  const recipientLockscript = '0x' + Buffer.from(recipient).toString('hex');
  const sudtExtraData = extra !== undefined ? '0x' + Buffer.from(extra).toString('hex') : '0x';

  const token = !asset ? ETH_ASSET : asset;
  let lockRes;
  if (token === ETH_ASSET) {
    lockRes = await bridgeWithSigner.lockETH(recipientLockscript, sudtExtraData, {
      value: ethers.utils.parseEther(amount),
    });
  } else {
    //TODO query precision according asset
    const precision = 8;
    lockRes = await bridgeWithSigner.lockToken(
      token,
      new Amount(amount, precision).toString(0),
      recipientLockscript,
      sudtExtraData,
      {
        gasLimit: 42000,
      },
    );
  }

  //TODO query symbol according asset
  const symbol = token === ETH_ASSET ? 'eth' : token;
  console.log(`Address:${lockRes.from} locked:${amount} ${symbol}, recipient:${recipient} extra:${extra}`);
  console.log(lockRes);
  if (opts.wait) {
    console.log('Waiting for transaction confirmed...');
    await lockRes.wait(3);
    console.log('Lock success.');
  }
}

async function doUnlock(
  opts: { recipient: boolean; privateKey: boolean; amount: boolean; wait?: boolean },
  command: commander.Command,
) {
  const options = parseOptions(opts, command);
  const recipientAddress = options.get('recipient');
  const privateKey = options.get('privateKey');
  const amount = options.get('amount');
  const token = !options.get('asset') ? ETH_ASSET : options.get('asset');

  const account = new Account(privateKey);
  const generator = new CkbTxGenerator(ForceBridgeCore.ckb, new IndexerCollector(ForceBridgeCore.ckbIndexer));
  const burnTx = await generator.burn(
    await account.getLockscript(),
    recipientAddress,
    new EthAsset(token, ForceBridgeCore.config.ckb.ownerLockHash),
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

async function doBalanceOf(opts: { address: boolean; asset?: boolean; origin?: boolean }, command: commander.Command) {
  const options = parseOptions(opts, command);
  const address = options.get('address');
  const token = !options.get('asset') ? ETH_ASSET : options.get('asset');

  if (opts.origin) {
    const provider = new ethers.providers.JsonRpcProvider(ForceBridgeCore.config.eth.rpcUrl);
    const balanceOf = await provider.getBalance(address);
    console.log(`BalanceOf address:${address} on ETH is ${formatEther(balanceOf)}`);
    return;
  }

  const asset = new EthAsset(token, ForceBridgeCore.config.ckb.ownerLockHash);
  const balance = await getSudtBalance(address, asset);
  console.log(`BalanceOf address:${address} on ckb is ${formatEther(balance.toString(0))}`);
}
