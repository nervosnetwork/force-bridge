import commander from 'commander';
import { parseOptions } from './utils';
import { BtcAsset } from '../../packages/ckb/model/asset';
import { Account } from '../../packages/ckb/model/accounts';
import { CkbTxGenerator } from '../../packages/ckb/tx-helper/generator';
import { IndexerCollector } from '../../packages/ckb/tx-helper/collector';
import { logger } from '../../packages/utils/logger';
import { Amount, Script } from '@lay2/pw-core';
import { ForceBridgeCore } from '../../packages/core';
import { BTCChain, getBtcMainnetFee, IBalance } from '../../packages/xchain/btc';
import bitcore from 'bitcore-lib';
import { RPCClient } from 'rpc-bitcoin';

const Unit = bitcore.Unit;

export const btcCmd = new commander.Command('btc');
btcCmd
  .command('lock')
  .requiredOption('-p, --privateKey', 'private key of locked account')
  .requiredOption('-u, --userAddr', 'address on btc')
  .requiredOption('-a, --amount', 'amount to lock. unit is btc')
  .requiredOption('-r, recipient', 'recipient address on ckb')
  .option('-e, extra', 'extra data of sudt')
  .option('--feeRate', 'satoshis/byte of tx data. default value will be from https://bitcoinfees.earn.com/#fees')
  .action(doLock)
  .description('lock asset on btc');

btcCmd
  .command('unlock')
  .requiredOption('-r, recipient', 'recipient address on btc')
  .requiredOption('-p, --privateKey', 'private key of unlock address on ckb')
  .requiredOption('-a, --amount', 'amount of unlock. unit is btc')
  .action(doUnlock)
  .description('unlock asset on btc');

btcCmd
  .command('balanceOf')
  .option('-p, --privateKey', 'private key of locked address on ckb. unit is btc')
  .option('-addr, --address', 'address on btc. unit is btc')
  .action(doBalanceOf)
  .description('query balance of address on btc');

async function doLock(opts: any, command: any) {
  const options = parseOptions(opts, command);
  const privateKey = options.get('privateKey');
  const amount = options.get('amount');
  const userAddr = options.get('userAddr');
  const recipient = options.get('recipient');
  const extra = options.get('extra');
  const feeRate = options.get('feeRate');
  const memo = extra === undefined ? recipient : `${recipient},${extra}`;
  const feeRateData = await getBtcMainnetFee();
  const txFeeRate = feeRate === undefined ? feeRateData.fastestFee : Number(feeRate);

  const btcChain = new BTCChain();
  const userPrivKey = new bitcore.PrivateKey(privateKey);
  const lockStartHeight = await btcChain.getBtcHeight();
  const lockTxHash = await btcChain.sendLockTxs(
    userAddr,
    Unit.fromBTC(amount).toSatoshis(),
    userPrivKey,
    memo,
    txFeeRate,
  );
  logger.debug(`user ${userAddr} lock ${amount} btc. the lock tx hash is ${lockTxHash} after block ${lockStartHeight}`);
}

async function doUnlock(opts: any, command: any) {
  const options = parseOptions(opts, command);
  const recipientAddress = options.get('recipient');
  const privateKey = options.get('privateKey');
  const amount = options.get('amount');

  const account = new Account(privateKey);
  const generator = new CkbTxGenerator(ForceBridgeCore.ckb, new IndexerCollector(ForceBridgeCore.indexer));
  const burnAmount = new Amount(Unit.fromBTC(amount).toSatoshis());
  const ownLockHash = ForceBridgeCore.ckb.utils.scriptToHash(<CKBComponents.Script>await account.getLockscript());
  const burnTx = await generator.burn(
    await account.getLockscript(),
    recipientAddress.toString(),
    new BtcAsset('btc', ownLockHash),
    burnAmount,
  );
  const signedTx = ForceBridgeCore.ckb.signTransaction(privateKey)(burnTx);
  const burnTxHash = await ForceBridgeCore.ckb.rpc.sendTransaction(signedTx);
  console.log(
    `Address:${account.address} unlock ${amount} , recipientAddress:${recipientAddress}, burnTxHash:${burnTxHash}`,
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
    const rpcClient = new RPCClient(ForceBridgeCore.config.btc.clientParams);
    const liveUtxos: IBalance = await rpcClient.scantxoutset({
      action: 'start',
      scanobjects: [`addr(${address})`],
    });
    console.log(`BalanceOf address:${address} on BTC is ${liveUtxos.total_amount} btc`);
  }
  if (privateKey) {
    const collector = new IndexerCollector(ForceBridgeCore.indexer);
    const account = new Account(privateKey);
    const ownLockHash = ForceBridgeCore.ckb.utils.scriptToHash(<CKBComponents.Script>await account.getLockscript());
    const asset = new BtcAsset('btc', ownLockHash);
    const bridgeCellLockscript = {
      codeHash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
      hashType: ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
      args: asset.toBridgeLockscriptArgs(),
    };
    const sudtArgs = ForceBridgeCore.ckb.utils.scriptToHash(<CKBComponents.Script>bridgeCellLockscript);
    const sudtType = {
      codeHash: ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash,
      hashType: ForceBridgeCore.config.ckb.deps.sudtType.script.hashType,
      args: sudtArgs,
    };
    const balance = await collector.getSUDTBalance(
      new Script(sudtType.codeHash, sudtType.args, sudtType.hashType),
      await account.getLockscript(),
    );
    console.log(`BalanceOf address:${account.address} on ckb is ${Unit.fromSatoshis(balance).toBTC()} xbtc`);
  }
}
