import { nonNullable } from '@force-bridge/x';
import { EthAsset } from '@force-bridge/x/dist/ckb/model/asset';
import { Config } from '@force-bridge/x/dist/config';
import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { BridgeFeeDB } from '@force-bridge/x/dist/db';
import { getDBConnection, parsePrivateKey } from '@force-bridge/x/dist/utils';
import { EthChain, WithdrawBridgeFeeTopic } from '@force-bridge/x/dist/xchain/eth';
import { Amount } from '@lay2/pw-core';
import commander from 'commander';
import { ecsign, toRpcSig } from 'ethereumjs-util';
import nconf from 'nconf';

const defaultConfig = './config.json';

export const feeCmd = new commander.Command('fee');

feeCmd
  .command('get-total-generated')
  .requiredOption('-x --xchain <xchain>', 'bridge fee of which blockchain')
  .requiredOption('-a --asset <asset>', 'bridge fee of which asset')
  .option('-cfg, --config <config>', `config path of force bridge default:${defaultConfig}`, defaultConfig)
  .action(getTotalGenerated);

feeCmd
  .command('get-total-withdrawed')
  .requiredOption('-x --xchain <xchain>', 'bridge fee of which blockchain')
  .requiredOption('-a --asset <asset>', 'bridge fee of which asset')
  .option('-cfg, --config <config>', `config path of force bridge default:${defaultConfig}`, defaultConfig)
  .action(getTotalWithdrawed);

feeCmd
  .command('get-total-available')
  .requiredOption('-x --xchain <xchain>', 'bridge fee of which blockchain')
  .requiredOption('-a --asset <asset>', 'bridge fee of which asset')
  .option('-cfg, --config <config>', `config path of force bridge default:${defaultConfig}`, defaultConfig)
  .action(getTotalAvailable);

feeCmd
  .command('generate-withdraw-tx-signature')
  .requiredOption('-x --xchain <xchain>', 'bridge fee of which blockchain')
  .requiredOption('-a --asset <asset>', 'bridge fee of which asset')
  .requiredOption('-r --recipient [recipients...]', 'bridge fee recipients')
  .requiredOption('-m --amount [amounts...]', 'bridge fee amounts')
  .option('-cfg, --config <config>', `config path of force bridge default:${defaultConfig}`, defaultConfig)
  .action(generateWithdrawTxSignature);

feeCmd
  .command('send-withdraw-tx')
  .requiredOption('-x --xchain <xchain>', 'bridge fee of which blockchain')
  .requiredOption('-a --asset <asset>', 'bridge fee of which asset')
  .requiredOption('-r --recipient [recipients...]', 'bridge fee recipients')
  .requiredOption('-m --amount [amounts...]', 'bridge fee amounts')
  .requiredOption('-s --signature [signatures...]', 'signatures of withdraw tx')
  .option('-cfg, --config <config>', `config path of force bridge default:${defaultConfig}`, defaultConfig)
  .option('-w, --wait', 'whether wait for transaction confirmed')
  .action(sendWithdrawTx);

async function getTotalGenerated(command: commander.Command) {
  const opts = command.opts();
  const xchain = nonNullable(opts.xchain);
  const asset = nonNullable(opts.asset);
  if (xchain !== 'ethereum') throw new Error('only support ethereum currently');
  const configPath = nonNullable(opts.config);

  nconf.env().file({ file: configPath });
  const cfg: Config = nconf.get('forceBridge');
  await new ForceBridgeCore().init(cfg);
  const conn = await getDBConnection();
  const bridgeFeeDB = new BridgeFeeDB(conn);
  const ethAsset = new EthAsset(asset);

  const bridgeInFee = await bridgeFeeDB.getEthTotalGeneratedBridgeInFee(asset);
  const humanizeBridgeInFee = ethAsset.getHumanizedDescription(bridgeInFee);
  console.log('total bridge-in fee:', humanizeBridgeInFee);

  const bridgeOutFee = await bridgeFeeDB.getEthTotalGeneratedBridgeOutFee(asset);
  const humanizeBridgeOutFee = ethAsset.getHumanizedDescription(bridgeOutFee);
  console.log('total bridge-out fee:', humanizeBridgeOutFee);

  const bridgeFee = await bridgeFeeDB.getEthTotalGeneratedBridgeFee(asset);
  const humanizeBridgtFee = ethAsset.getHumanizedDescription(bridgeFee);
  console.log('total bridge fee:', humanizeBridgtFee);
}

async function getTotalWithdrawed(command: commander.Command) {
  const opts = command.opts();
  const xchain = nonNullable(opts.xchain);
  const asset = nonNullable(opts.asset);
  if (xchain !== 'ethereum') throw new Error('only support ethereum currently');
  const configPath = nonNullable(opts.config);

  nconf.env().file({ file: configPath });
  const cfg: Config = nconf.get('forceBridge');
  await new ForceBridgeCore().init(cfg);
  const conn = await getDBConnection();
  const bridgeFeeDB = new BridgeFeeDB(conn);
  const ethAsset = new EthAsset(asset);

  const withdrawedBridgeFee = await bridgeFeeDB.getEthTotalWithdrawedBridgeFee(asset);
  const humanizedWithdrawedBridgeFee = ethAsset.getHumanizedDescription(withdrawedBridgeFee);
  console.log('total withdrawed bridge fee:', humanizedWithdrawedBridgeFee);
}

async function getTotalAvailable(command: commander.Command) {
  const opts = command.opts();
  const xchain = nonNullable(opts.xchain);
  const asset = nonNullable(opts.asset);
  if (xchain !== 'ethereum') throw new Error('only support ethereum currently');
  const configPath = nonNullable(opts.config);

  nconf.env().file({ file: configPath });
  const cfg: Config = nconf.get('forceBridge');
  await new ForceBridgeCore().init(cfg);
  const conn = await getDBConnection();
  const bridgeFeeDB = new BridgeFeeDB(conn);
  const ethAsset = new EthAsset(asset);

  const withdrawedBridgeFee = await bridgeFeeDB.getEthTotalWithdrawedBridgeFee(asset);
  const generatedBridgeFee = await bridgeFeeDB.getEthTotalGeneratedBridgeFee(asset);
  const availableBridgeFee = new Amount(generatedBridgeFee, 0).add(new Amount(withdrawedBridgeFee, 0)).toString(0);
  const humanizedAvailableBridgeFee = ethAsset.getHumanizedDescription(availableBridgeFee);
  console.log('total available bridge fee:', humanizedAvailableBridgeFee);
}

async function generateWithdrawTxSignature(command: commander.Command) {
  const opts = command.opts();
  const xchain = nonNullable(opts.xchain);
  if (xchain !== 'ethereum') throw new Error('only support ethereum currently');
  const asset = nonNullable(opts.asset);
  const ethAsset = new EthAsset(asset);
  const recipient = nonNullable(opts.recipient);
  const amount = nonNullable(opts.amount);
  if (recipient.length !== amount.length) throw new Error('recipient number should equal amount number');
  const configPath = nonNullable(opts.config);
  nconf.env().file({ file: configPath });
  const cfg: Config = nconf.get('forceBridge');
  await new ForceBridgeCore().init(cfg);

  const withdrawRecords = recipient.map((r, i) => {
    return {
      ckbTxHash: WithdrawBridgeFeeTopic,
      token: asset,
      amount: ethAsset.parseAmount(amount[i]),
      recipient: r,
    };
  });
  const ethChain = new EthChain('verifier');
  const message = await ethChain.getUnlockMessageToSign(withdrawRecords);
  const privKeyPath = ForceBridgeCore.config.eth.multiSignKeys[0].privKey;
  const privKey = parsePrivateKey(privKeyPath);
  const { v, r, s } = ecsign(Buffer.from(message.slice(2), 'hex'), Buffer.from(privKey.slice(2), 'hex'));
  console.log(`signature of withdraw tx: ${toRpcSig(v, r, s)}`);
}

async function sendWithdrawTx(command: commander.Command) {
  const opts = command.opts();
  const xchain = nonNullable(opts.xchain);
  if (xchain !== 'ethereum') throw new Error('only support ethereum currently');
  const asset = nonNullable(opts.asset);
  const ethAsset = new EthAsset(asset);
  const recipient = nonNullable(opts.recipient);
  const amount = nonNullable(opts.amount);
  const signature = nonNullable(opts.signature);
  if (recipient.length !== amount.length) throw new Error('recipient number should equal amount number');
  const configPath = nonNullable(opts.config);
  nconf.env().file({ file: configPath });
  const cfg: Config = nconf.get('forceBridge');
  await new ForceBridgeCore().init(cfg);

  const withdrawRecords = recipient.map((r, i) => {
    return {
      ckbTxHash: WithdrawBridgeFeeTopic,
      token: asset,
      amount: ethAsset.parseAmount(amount[i]),
      recipient: r,
    };
  });
  const ethChain = new EthChain('collector');
  const parsedSigs = signature.map((s) => s.slice(2));
  const txRes = await ethChain.sendWithdrawBridgeFeeTx(withdrawRecords, parsedSigs);
  if (opts.wait) {
    const receipt = await txRes.wait();
    if (receipt.status == 1) {
      console.log(`send withdraw tx sucess, tx hash: ${txRes.hash}`);
    } else {
      console.log(`send withdraw tx failed, tx receipt: ${receipt}`);
    }
  } else {
    console.log(`withdraw tx was sent, tx hash: ${txRes.hash}`);
  }
}
