import { ForceBridgeAPIV1Client } from '@force-bridge/app-rpc-server/dist/client';
import { nonNullable } from '@force-bridge/x';
import { Amount } from '@lay2/pw-core';
import CKB from '@nervosnetwork/ckb-sdk-core';
import commander from 'commander';
import { ethers } from 'ethers';
import { ckbPrivateKeyToAddress, parseOptions, waitUnlockCompleted } from './utils';

const ForceBridgeRpc = 'http://127.0.0.1:8080/force-bridge/api/v1';
const EthNodeRpc = 'http://127.0.0.1:8545';
const CkbNodeRpc = 'http://127.0.0.1:8114';

export const ethCmd = new commander.Command('eth');
ethCmd
  .command('lock')
  .requiredOption('-p, --privateKey', 'private key of locked account')
  .requiredOption('-a, --amount', 'amount to lock')
  .requiredOption('-r, --recipient', 'recipient address on ckb')
  .option('-n, --name', 'token name', 'ETH')
  .option('--ethRpcUrl', 'Url of eth rpc', EthNodeRpc)
  .option('--forceBridgeRpcUrl', 'Url of force-bridge rpc', ForceBridgeRpc)
  .option('-w, --wait', 'whether wait for transaction confirmed')
  .action(doLock)
  .description('lock asset on eth');

ethCmd
  .command('unlock')
  .requiredOption('-r, --recipient', 'recipient address on eth')
  .requiredOption('-p, --privateKey', 'private key of unlock address on ckb')
  .requiredOption('-a, --amount', 'amount of unlock')
  .option('-n, --name', 'token name', 'ckETH')
  .option('--ckbRpcUrl', 'Url of ckb rpc', CkbNodeRpc)
  .option('--forceBridgeRpcUrl', 'Url of force-bridge rpc', ForceBridgeRpc)
  .option('-w, --wait', 'whether wait for transaction confirmed')
  .action(doUnlock)
  .description('unlock asset on eth');

ethCmd
  .command('balanceOf')
  .requiredOption('-addr, --address', 'address on eth or ckb')
  .option('-n, --name', 'token name', 'ETH')
  .option('--forceBridgeRpcUrl', 'Url of force-bridge rpc', ForceBridgeRpc)
  .action(doBalanceOf)
  .description('query balance of address on eth or ckb');

ethCmd
  .command('assetList')
  .option('--forceBridgeRpcUrl', 'Url of force-bridge rpc', ForceBridgeRpc)
  .option('-d, --detail', 'show detail asset list info')
  .action(getAssetList)
  .description('get support asset list on eth');

ethCmd
  .command('txSummaries')
  .requiredOption('-addr, --address', 'address on eth or ckb')
  .option('-n, --name', 'token name', 'ETH')
  .option('--forceBridgeRpcUrl', 'Url of force-bridge rpc', ForceBridgeRpc)
  .action(getTxSummaries)
  .description(`get transaction summaries`);

async function doLock(
  opts: {
    privateKey: boolean;
    amount: boolean;
    recipient: boolean;
    name?: boolean;
    ethRpcUrl?: boolean;
    forceBridgeRpcUrl?: boolean;
    wait?: boolean;
  },
  command: commander.Command,
) {
  const options = parseOptions(opts, command);
  const privateKey = nonNullable(options.get('privateKey'));
  const amount = nonNullable(options.get('amount'));
  const recipient = nonNullable(options.get('recipient'));
  const tokenName = nonNullable(options.get('name') || 'ETH');
  const forceBridgeRpc = nonNullable(options.get('forceBridgeRpcUrl') || ForceBridgeRpc);
  const ethRpc = nonNullable(options.get('ethRpcUrl') || EthNodeRpc);

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

  if (opts.wait) {
    console.log('Waiting for transaction confirmed...');
    await lockRes.wait(3);
    console.log('Lock success.');
  }
}

async function doUnlock(
  opts: {
    recipient: boolean;
    privateKey: boolean;
    amount: boolean;
    name?: boolean;
    ckbRpc?: boolean;
    forceBridgeRpc?: boolean;
    wait?: boolean;
  },
  command: commander.Command,
) {
  const options = parseOptions(opts, command);
  const recipientAddress = nonNullable(options.get('recipient'));
  const privateKey = nonNullable(options.get('privateKey'));
  const amount = nonNullable(options.get('amount'));
  const tokenName = nonNullable(options.get('name') || 'ckETH');
  const ckbRpc = nonNullable(options.get('ckbRpcUrl') || CkbNodeRpc);
  const forceBridgeRpc = nonNullable(options.get('forceBridgeRpcUrl') || ForceBridgeRpc);

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

  if (opts.wait) {
    await waitUnlockCompleted(ckb, unlockTxHash);
  }
}

async function doBalanceOf(
  opts: { address: boolean; name?: boolean; forceBridgeRpcUrl?: boolean },
  command: commander.Command,
) {
  const options = parseOptions(opts, command);
  const address = nonNullable(options.get('address'));
  const tokenName = nonNullable(options.get('name') || 'ETH');
  const forceBridgeRpc = nonNullable(options.get('forceBridgeRpcUrl') || ForceBridgeRpc);

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

async function getAssetList(opts: { forceBridgeRpcUrl?: boolean; detail?: boolean }, command: commander.Command) {
  const options = parseOptions(opts, command);
  const forceBridgeRpc = nonNullable(options.get('forceBridgeRpcUrl') || ForceBridgeRpc);
  const assetList = await new ForceBridgeAPIV1Client(forceBridgeRpc).getAssetList();
  if (opts.detail) {
    console.log(JSON.stringify(assetList, undefined, 2));
    return;
  }

  assetList.forEach((asset) => {
    console.log(`Network:${asset.network} Name:${asset.info.name} Ident:${asset.ident}`);
  });
}

async function getTxSummaries(opts: { address: boolean; forceBridgeRpcUrl?: boolean }, command: commander.Command) {
  const options = parseOptions(opts, command);
  const tokenName = nonNullable(options.get('name') || 'ETH');
  const forceBridgeRpc = nonNullable(options.get('forceBridgeRpcUrl') || ForceBridgeRpc);
  const address = nonNullable(options.get('address'));

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
