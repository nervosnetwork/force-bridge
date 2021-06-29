import { ForceBridgeAPIV1Client } from '@force-bridge/app-rpc-server/dist/client';
import { nonNullable } from '@force-bridge/x';
import { Amount } from '@lay2/pw-core';
import CKB from '@nervosnetwork/ckb-sdk-core';
import commander from 'commander';
// import { ethers } from 'ethers';
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
  .option('-s, --symbol', `token symbol default:ETH`, 'ETH')
  .option('-eth-rpc, --ethRpcUrl', `Url of eth rpc default:${EthNodeRpc}`, EthNodeRpc)
  .option('-rpc, --forceBridgeRpcUrl', `Url of force-bridge rpc default:${ForceBridgeRpc}`, ForceBridgeRpc)
  .option('-w, --wait', 'whether wait for transaction confirmed')
  .action(doLock)
  .description('lock asset on eth');

ethCmd
  .command('unlock')
  .requiredOption('-r, --recipient', 'recipient address on eth')
  .requiredOption('-p, --privateKey', 'private key of unlock address on ckb')
  .requiredOption('-a, --amount', 'amount of unlock')
  .option('-s, --symbol', `token symbol default:ckETH`, 'ckETH')
  .option('--ckbRpcUrl', `Url of ckb rpc default:${CkbNodeRpc}`, CkbNodeRpc)
  .option('-rpc, --forceBridgeRpcUrl', `Url of force-bridge rpc default:${ForceBridgeRpc}`, ForceBridgeRpc)
  .option('-w, --wait', 'whether wait for transaction confirmed')
  .action(doUnlock)
  .description('unlock asset on eth');

ethCmd
  .command('balanceOf')
  .requiredOption('-addr, --address', 'address on eth or ckb')
  .option('-s, --symbol', `token symbol default:ETH`, 'ETH')
  .option('-rpc, --forceBridgeRpcUrl', `Url of force-bridge rpc default:${ForceBridgeRpc}`, ForceBridgeRpc)
  .action(doBalanceOf)
  .description('query balance of address on eth or ckb');

ethCmd
  .command('assetList')
  .option('-rpc, --forceBridgeRpcUrl', `Url of force-bridge rpc default:${ForceBridgeRpc}`, ForceBridgeRpc)
  .option('-d, --detail', 'show detail asset list info')
  .action(getAssetList)
  .description('get support asset list on eth');

ethCmd
  .command('txSummaries')
  .requiredOption('-addr, --address', 'address on eth or ckb')
  .option('-s, --symbol', `token symbol default:ETH`, 'ETH')
  .option('-rpc, --forceBridgeRpcUrl', `Url of force-bridge rpc default:${ForceBridgeRpc}`, ForceBridgeRpc)
  .action(getTxSummaries)
  .description(`get transaction summaries`);

async function doLock(command: commander.Command, args: string[]) {
  const opts = command.opts();
  const options = parseOptions(opts, args);
  const privateKey = nonNullable(options.get('privateKey'));
  const amount = nonNullable(options.get('amount'));
  const recipient = nonNullable(options.get('recipient'));
  const tokenSymbol = nonNullable(options.get('symbol') || 'ETH');
  const forceBridgeRpc = nonNullable(options.get('forceBridgeRpcUrl') || ForceBridgeRpc);
  const ethRpc = nonNullable(options.get('ethRpcUrl') || EthNodeRpc);
  console.log(JSON.stringify(opts, undefined, 2));
  console.log(JSON.stringify(privateKey, undefined, 2));
  console.log(JSON.stringify(amount, undefined, 2));
  console.log(JSON.stringify(recipient, undefined, 2));
  console.log(JSON.stringify(tokenSymbol, undefined, 2));
  console.log(JSON.stringify(forceBridgeRpc, undefined, 2));
  console.log(JSON.stringify(ethRpc, undefined, 2));
  //
  // const assetList = await new ForceBridgeAPIV1Client(forceBridgeRpc).getAssetList();
  // const assetInfo = assetList.find((asset) => {
  //   return asset.info.symbol === tokenSymbol;
  // });
  // if (assetInfo === undefined) {
  //   console.log(`Invalid token symbol:${tokenSymbol}`);
  //   return;
  // }
  //
  // const mintPayload = {
  //   sender: '0x0',
  //   recipient: recipient,
  //   asset: {
  //     network: 'Ethereum',
  //     ident: assetInfo.ident,
  //     amount: new Amount(amount, assetInfo.info.decimals).toString(0),
  //   },
  // };
  // const lockTx = nonNullable(
  //   await new ForceBridgeAPIV1Client(forceBridgeRpc).generateBridgeInNervosTransaction(mintPayload),
  // );
  //
  // const provider = new ethers.providers.JsonRpcProvider(ethRpc);
  // const wallet = new ethers.Wallet(privateKey, provider);
  //
  // const unsignedTx = <ethers.PopulatedTransaction>lockTx.rawTransaction;
  // unsignedTx.nonce = await wallet.getTransactionCount();
  // unsignedTx.gasLimit = ethers.BigNumber.from(1000000);
  // unsignedTx.gasPrice = ethers.BigNumber.from(0);
  //
  // const signedTx = await wallet.signTransaction(unsignedTx);
  // const lockRes = await provider.sendTransaction(signedTx);
  //
  // console.log(
  //   `Address:${wallet.address} locked:${amount} ${assetInfo.info.symbol}, recipient:${recipient}, lockTxHash:${lockRes.hash}`,
  // );
  //
  // if (opts.wait) {
  //   console.log('Waiting for transaction confirmed...');
  //   await lockRes.wait(3);
  //   console.log('Lock success.');
  // }
}

async function doUnlock(command: commander.Command, args: string[]) {
  const opts = command.opts();
  const options = parseOptions(opts, args);
  const recipientAddress = nonNullable(options.get('recipient'));
  const privateKey = nonNullable(options.get('privateKey'));
  const amount = nonNullable(options.get('amount'));
  const tokenSymbol = nonNullable(options.get('symbol') || 'ckETH');
  const ckbRpc = nonNullable(options.get('ckbRpcUrl') || CkbNodeRpc);
  const forceBridgeRpc = nonNullable(options.get('forceBridgeRpcUrl') || ForceBridgeRpc);

  const forceClient = new ForceBridgeAPIV1Client(forceBridgeRpc);
  const forceConfig = await forceClient.getBridgeConfig();

  const ckb = new CKB(ckbRpc);
  const ckbAddress = ckbPrivateKeyToAddress(privateKey, forceConfig.nervos.network);

  const assetList = await forceClient.getAssetList();
  const assetInfo = assetList.find((asset) => {
    return asset.info.symbol === tokenSymbol;
  });
  if (assetInfo === undefined) {
    console.log(`Invalid token symbol:${tokenSymbol}`);
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

async function doBalanceOf(command: commander.Command, args: string[]) {
  const opts = command.opts();
  const options = parseOptions(opts, args);
  const address = nonNullable(options.get('address'));
  const tokenSymbol = nonNullable(options.get('symbol') || 'ETH');
  const forceBridgeRpc = nonNullable(options.get('forceBridgeRpcUrl') || ForceBridgeRpc);

  const assetList = await new ForceBridgeAPIV1Client(forceBridgeRpc).getAssetList();
  const assetInfo = assetList.find((asset) => {
    return asset.info.symbol === tokenSymbol;
  });
  if (assetInfo === undefined) {
    console.log(`Invalid token symbol:${tokenSymbol}`);
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

async function getAssetList(command: commander.Command, args: string[]) {
  const opts = command.opts();
  const options = parseOptions(opts, args);
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

async function getTxSummaries(command: commander.Command, args: string[]) {
  const opts = command.opts();
  const options = parseOptions(opts, args);
  const tokenSymbol = nonNullable(options.get('symbol') || 'ETH');
  const forceBridgeRpc = nonNullable(options.get('forceBridgeRpcUrl') || ForceBridgeRpc);
  const address = nonNullable(options.get('address'));

  const assetList = await new ForceBridgeAPIV1Client(forceBridgeRpc).getAssetList();
  const assetInfo = assetList.find((asset) => {
    return asset.info.symbol === tokenSymbol;
  });
  if (assetInfo === undefined) {
    console.log(`Invalid token symbol:${tokenSymbol}`);
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
