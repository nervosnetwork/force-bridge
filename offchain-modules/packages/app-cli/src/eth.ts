import { ForceBridgeAPIV1Client } from '@force-bridge/app-rpc-server/dist/client';
import { nonNullable } from '@force-bridge/x';
import { Amount } from '@lay2/pw-core';
import CKB from '@nervosnetwork/ckb-sdk-core';
import commander from 'commander';
import { ethers } from 'ethers';
import { ckbPrivateKeyToAddress, waitUnlockCompleted } from './utils';

const ForceBridgeRpc = 'http://47.56.233.149:3083/force-bridge/api/v1';
const EthNodeRpc = 'http://127.0.0.1:8545';
const CkbNodeRpc = 'http://127.0.0.1:8114';

export const ethCmd = new commander.Command('eth');
ethCmd
  .command('lock')
  .requiredOption('-p, --privateKey <privateKey>', 'private key of locked account')
  .requiredOption('-a, --amount <amount>', 'amount to lock')
  .requiredOption('-r, --recipient <recipient>', 'recipient address on ckb')
  .option('-n, --name <name>', 'token name', 'ETH')
  .option('--ethRpcUrl <ethRpcUrl>', 'Url of eth rpc', EthNodeRpc)
  .option('--forceBridgeRpcUrl <forceBridgeRpcUrl>', 'Url of force-bridge rpc', ForceBridgeRpc)
  .option('-w, --wait', 'whether wait for transaction confirmed')
  .action(doLock)
  .description('lock asset on eth');

ethCmd
  .command('unlock')
  .requiredOption('-r, --recipient <recipient>', 'recipient address on eth')
  .requiredOption('-p, --privateKey <privateKey>', 'private key of unlock address on ckb')
  .requiredOption('-a, --amount <amount>', 'amount of unlock')
  .option('-n, --name <name>', 'token name', 'ckETH')
  .option('--ckbRpcUrl <ckbRpcUrl>', 'Url of ckb rpc', CkbNodeRpc)
  .option('--forceBridgeRpcUrl <forceBridgeRpcUrl>', 'Url of force-bridge rpc', ForceBridgeRpc)
  .option('-w, --wait', 'whether wait for transaction confirmed')
  .action(doUnlock)
  .description('unlock asset on eth');

ethCmd
  .command('balanceOf')
  .requiredOption('-addr, --address <address>', 'address on eth or ckb')
  .option('-n, --name <name>', 'token name', 'ETH')
  .option('--forceBridgeRpcUrl <forceBridgeRpcUrl>', 'Url of force-bridge rpc', ForceBridgeRpc)
  .action(doBalanceOf)
  .description('query balance of address on eth or ckb');

ethCmd
  .command('assetList')
  .option('--forceBridgeRpcUrl <forceBridgeRpcUrl>', 'Url of force-bridge rpc', ForceBridgeRpc)
  .option('-d, --detail', 'show detail asset list info')
  .action(getAssetList)
  .description('get support asset list on eth');

ethCmd
  .command('txSummaries')
  .requiredOption('-addr, --address <address>', 'address on eth or ckb')
  .option('-n, --name <name>', 'token name', 'ETH')
  .option('--forceBridgeRpcUrl <forceBridgeRpcUrl>', 'Url of force-bridge rpc', ForceBridgeRpc)
  .action(getTxSummaries)
  .description(`get transaction summaries`);

async function doLock(opts: Record<string, string | boolean>) {
  const privateKey = nonNullable(opts.privateKey) as string;
  const amount = nonNullable(opts.amount) as string;
  const recipient = nonNullable(opts.recipient) as string;
  const tokenName = nonNullable(opts.name || 'ETH') as string;
  const forceBridgeRpc = nonNullable(opts.forceBridgeRpcUrl || ForceBridgeRpc) as string;
  const ethRpc = nonNullable(opts.ethRpcUrl || EthNodeRpc) as string;

  const assetList = await new ForceBridgeAPIV1Client(forceBridgeRpc).getAssetList();
  const assetInfo = assetList.find((asset) => {
    return asset.info.name === tokenName;
  });
  if (assetInfo === undefined) {
    console.log(`Invalid token name:${tokenName}`);
    return;
  }

  const mintPayload = {
    sender: '0x0',
    recipient: recipient,
    asset: {
      network: 'Ethereum',
      ident: assetInfo.ident,
      amount: new Amount(amount, assetInfo.info.decimals).toString(0),
    },
  };
  const lockTx = nonNullable(
    await new ForceBridgeAPIV1Client(forceBridgeRpc).generateBridgeInNervosTransaction(mintPayload),
  );

  const provider = new ethers.providers.JsonRpcProvider(ethRpc);
  const wallet = new ethers.Wallet(privateKey, provider);

  const unsignedTx = <ethers.PopulatedTransaction>lockTx.rawTransaction;
  unsignedTx.nonce = await wallet.getTransactionCount();
  unsignedTx.gasLimit = ethers.BigNumber.from(1000000);
  unsignedTx.gasPrice = ethers.BigNumber.from(0);

  const signedTx = await wallet.signTransaction(unsignedTx);
  const lockRes = await provider.sendTransaction(signedTx);

  console.log(
    `Address:${wallet.address} locked:${amount} ${assetInfo.info.symbol}, recipient:${recipient}, lockTxHash:${lockRes.hash}`,
  );

  if (opts.wait as boolean) {
    console.log('Waiting for transaction confirmed...');
    await lockRes.wait(3);
    console.log('Lock success.');
  }
}

async function doUnlock(opts: Record<string, string | boolean>) {
  const recipientAddress = nonNullable(opts.recipient) as string;
  const privateKey = nonNullable(opts.privateKey) as string;
  const amount = nonNullable(opts.amount) as string;
  const tokenName = nonNullable(opts.name || 'ckETH') as string;
  const ckbRpc = nonNullable(opts.ckbRpcUrl || CkbNodeRpc) as string;
  const forceBridgeRpc = nonNullable(opts.forceBridgeRpcUrl || ForceBridgeRpc) as string;

  const forceClient = new ForceBridgeAPIV1Client(forceBridgeRpc);
  const forceConfig = await forceClient.getBridgeConfig();

  const ckb = new CKB(ckbRpc);
  const ckbAddress = ckbPrivateKeyToAddress(privateKey, forceConfig.nervos.network);

  const assetList = await forceClient.getAssetList();
  const assetInfo = assetList.find((asset) => {
    return asset.info.name === tokenName;
  });
  if (assetInfo === undefined) {
    console.log(`Invalid token name:${tokenName}`);
    return;
  }

  const burnPayload = {
    network: 'Ethereum',
    sender: ckbAddress,
    recipient: recipientAddress,
    asset: assetInfo.info.shadow.ident,
    amount: new Amount(amount, assetInfo.info.decimals).toString(0),
  };

  const unlockTx = await new ForceBridgeAPIV1Client(forceBridgeRpc).generateBridgeOutNervosTransaction(burnPayload);
  const signedTx = ckb.signTransaction(privateKey)(<CKBComponents.RawTransactionToSign>unlockTx.rawTransaction);
  const unlockTxHash = await ckb.rpc.sendTransaction(signedTx);

  console.log(
    `Address:${ckbAddress} unlock ${amount} ${assetInfo.info.symbol}, recipientAddress:${recipientAddress}, unlockTxHash:${unlockTxHash}`,
  );

  if (opts.wait as boolean) {
    await waitUnlockCompleted(ckb, unlockTxHash);
  }
}

async function doBalanceOf(opts: Record<string, string>) {
  const address = nonNullable(opts.address);
  const tokenName = nonNullable(opts.name || 'ETH');
  const forceBridgeRpc = nonNullable(opts.forceBridgeRpcUrl || ForceBridgeRpc);

  const assetList = await new ForceBridgeAPIV1Client(forceBridgeRpc).getAssetList();
  const assetInfo = assetList.find((asset) => {
    return asset.info.name === tokenName;
  });
  if (assetInfo === undefined) {
    console.log(`Invalid token name:${tokenName}`);
    return;
  }

  const balances = await new ForceBridgeAPIV1Client(forceBridgeRpc).getBalance([
    {
      network: assetInfo.network,
      userIdent: address,
      assetIdent: assetInfo.ident,
    },
  ]);
  balances.forEach((balance) => {
    console.log(
      `Address:${address} balance:${new Amount(balance.amount, 0).toString(assetInfo.info.decimals)} ${
        assetInfo.info.symbol
      }`,
    );
  });
}

async function getAssetList(opts: Record<string, string | boolean>) {
  const forceBridgeRpc = nonNullable(opts.forceBridgeRpcUrl || ForceBridgeRpc) as string;
  const assetList = await new ForceBridgeAPIV1Client(forceBridgeRpc).getAssetList();
  if (opts.detail as boolean) {
    console.log(JSON.stringify(assetList, undefined, 2));
    return;
  }

  assetList.forEach((asset) => {
    console.log(`Network:${asset.network} Name:${asset.info.name} Ident:${asset.ident}`);
  });
}

async function getTxSummaries(opts: Record<string, string>) {
  const tokenName = nonNullable(opts.name || 'ETH');
  const forceBridgeRpc = nonNullable(opts.forceBridgeRpcUrl || ForceBridgeRpc);
  const address = nonNullable(opts.address);

  const assetList = await new ForceBridgeAPIV1Client(forceBridgeRpc).getAssetList();
  const assetInfo = assetList.find((asset) => {
    return asset.info.name === tokenName;
  });
  if (assetInfo === undefined) {
    console.log(`Invalid token name:${tokenName}`);
    return;
  }

  const txSummaries = nonNullable(
    await new ForceBridgeAPIV1Client(forceBridgeRpc).getBridgeTransactionSummaries({
      network: 'Ethereum',
      xchainAssetIdent: assetInfo.ident,
      user: {
        network: 'Ethereum',
        ident: address,
      },
    }),
  );

  console.log(JSON.stringify(txSummaries, undefined, 2));
}
