import assert from 'assert';
import { parseAddress } from '@ckb-lumos/helpers';
import { ChainType, EthAsset } from '@force-bridge/x/dist/ckb/model/asset';
import { IndexerCollector } from '@force-bridge/x/dist/ckb/tx-helper/collector';
import { CkbTxGenerator } from '@force-bridge/x/dist/ckb/tx-helper/generator';
import { CkbIndexer } from '@force-bridge/x/dist/ckb/tx-helper/indexer';
import { getOwnerTypeHash } from '@force-bridge/x/dist/ckb/tx-helper/multisig/multisig_helper';
import { Config, EthConfig } from '@force-bridge/x/dist/config';
import { bootstrap, ForceBridgeCore } from '@force-bridge/x/dist/core';
import { CkbMint, EthLock, EthUnlock } from '@force-bridge/x/dist/db/model';
import {
  asyncSleep,
  getDBConnection,
  stringToUint8Array,
  toHexString,
  uint8ArrayToString,
} from '@force-bridge/x/dist/utils';
import { logger } from '@force-bridge/x/dist/utils/logger';
import { ETH_ADDRESS } from '@force-bridge/x/dist/xchain/eth';
import { abi } from '@force-bridge/x/dist/xchain/eth/abi/ForceBridge.json';
import { ForceBridgeContract, reconc } from '@force-bridge/xchain-eth';
import { Amount } from '@lay2/pw-core';
import CKB from '@nervosnetwork/ckb-sdk-core';
import { ethers } from 'ethers';
import nconf from 'nconf';
import { waitUntilCommitted } from '../src/utils';
const CKB_URL = process.env.CKB_URL || 'http://127.0.0.1:8114';
const CKB_INDEXER_URL = process.env.CKB_INDEXER_URL || 'http://127.0.0.1:8116';
const indexer = new CkbIndexer(CKB_URL, CKB_INDEXER_URL);
const collector = new IndexerCollector(indexer);

const ckb = new CKB(CKB_URL);
const ETH_PRI_KEY = process.env.ETH_PRI_KEY || '0xc4ad657963930fbff2e9de3404b30a4e21432c89952ed430b56bf802945ed37a';
const RECIPIENT_PRI_KEY = '0xd00c06bfd800d27397002dca6fb0993d5ba6399b4238b2f29ee9deb97593d2bc';
const RECIPIENT_ADDR = 'ckt1qyqvsv5240xeh85wvnau2eky8pwrhh4jr8ts8vyj37';

async function main() {
  // ckb account to recieve ckETH and send burn tx
  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const conf: Config = nconf.get('forceBridge');
  const config: EthConfig = conf.eth;
  conf.common.log.logFile = './log/eth-ci.log';
  await bootstrap(conf);
  logger.info('config', config);

  const conn = await getDBConnection();

  const provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
  const bridgeContractAddr = config.contractAddress;
  const bridge = new ethers.Contract(bridgeContractAddr, abi, provider) as ForceBridgeContract;
  const wallet = new ethers.Wallet(ETH_PRI_KEY, provider);
  const bridgeWithSigner = bridge.connect(wallet);
  const iface = new ethers.utils.Interface(abi);

  const bridgeFee = ForceBridgeCore.config.eth.assetWhiteList.filter((asset) => asset.symbol === 'ETH')[0].bridgeFee;
  logger.info('bridge fee', bridgeFee);

  // lock eth
  const recipientLockscript = stringToUint8Array(RECIPIENT_ADDR);
  logger.info('recipientLockscript', toHexString(recipientLockscript));
  const sudtExtraData = '0x01';
  const amount = ethers.utils.parseEther('0.1');
  const lockRes = await bridgeWithSigner.lockETH(recipientLockscript, sudtExtraData, { value: amount });
  logger.info('lockRes', lockRes);
  const txHash = lockRes.hash;
  const receipt = await lockRes.wait();
  logger.info('receipt', receipt);

  // get sudt balance before
  const recipientFromLockscript = parseAddress(RECIPIENT_ADDR);
  const ownerTypeHash = getOwnerTypeHash();
  const asset = new EthAsset('0x0000000000000000000000000000000000000000', ownerTypeHash);
  const bridgeCellLockscript = {
    code_hash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
    hash_type: ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
    args: asset.toBridgeLockscriptArgs(),
  };
  const sudtArgs = ckb.utils.scriptToHash(<CKBComponents.Script>{
    codeHash: bridgeCellLockscript.code_hash,
    hashType: bridgeCellLockscript.hash_type,
    args: bridgeCellLockscript.args,
  });
  const sudtType = {
    code_hash: ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash,
    hash_type: ForceBridgeCore.config.ckb.deps.sudtType.script.hashType,
    args: sudtArgs,
  };
  const recipientBalanceBefore = await collector.getSUDTBalance(sudtType, recipientFromLockscript);

  // create eth unlock
  const recipientAddress = '0x1000000000000000000000000000000000000001';
  const balanceBefore = await provider.getBalance(recipientAddress);
  logger.info('balanceBefore burn', balanceBefore);

  let sendBurn = false;
  let burnTxHash;
  let expectBalanceAfterBurn = 0n;
  const checkEffect = async () => {
    // check EthLock and CkbMint saved.
    const ethLockRecords = await conn.manager.find(EthLock, {
      where: {
        txHash,
      },
    });
    logger.info('ethLockRecords', ethLockRecords);
    assert(ethLockRecords.length === 1);
    const ethLockRecord = ethLockRecords[0];
    assert(ethLockRecord.sudtExtraData === sudtExtraData);
    assert(ethLockRecord.sender === wallet.address);
    assert(ethLockRecord.token === ETH_ADDRESS);
    assert(ethLockRecord.amount === amount.toString());
    assert(ethLockRecord.bridgeFee === bridgeFee.in);
    logger.info('ethLockRecords recipient', ethLockRecord.recipient);
    logger.info('ethLockRecords', `0x${toHexString(recipientLockscript)}`);
    logger.info('expect recipient', `${uint8ArrayToString(recipientLockscript)}`);
    assert(ethLockRecord.recipient === `${uint8ArrayToString(recipientLockscript)}`);

    const mintAmount = new Amount(ethLockRecord.amount, 0).sub(new Amount(ethLockRecord.bridgeFee, 0)).toString(0);
    const ckbMintRecords = await conn.manager.find(CkbMint, {
      where: {
        id: txHash,
      },
    });
    logger.info('ckbMintRecords', ckbMintRecords);
    assert(ckbMintRecords.length === 1);
    const ckbMintRecord = ckbMintRecords[0];
    assert(ckbMintRecord.chain === ChainType.ETH);
    assert(ethLockRecord.sudtExtraData === sudtExtraData);
    assert(ckbMintRecord.status === 'success');
    assert(ckbMintRecord.asset === ETH_ADDRESS);
    assert(ckbMintRecord.amount === mintAmount);
    assert(ckbMintRecord.recipientLockscript === `${uint8ArrayToString(recipientLockscript)}`);

    // check sudt balance.
    const recipientBalance = await collector.getSUDTBalance(sudtType, recipientFromLockscript);

    if (!sendBurn) {
      logger.info('recipient sudt balance on chain:', recipientBalance);
      const expectBalance = recipientBalanceBefore + BigInt(mintAmount);
      logger.info('expect recipient balance:', expectBalance);
      assert(recipientBalance === expectBalance);
    }

    // send burn tx
    const burnAmount = ethers.utils.parseEther('0.01');
    if (!sendBurn) {
      const generator = new CkbTxGenerator(ckb, indexer);
      const burnTx = await generator.burn(
        recipientFromLockscript,
        recipientAddress,
        new EthAsset('0x0000000000000000000000000000000000000000', ownerTypeHash),
        // Amount.fromUInt128LE('0x01'),
        burnAmount.toBigInt(),
      );
      const signedTx = ckb.signTransaction(RECIPIENT_PRI_KEY)(burnTx);
      logger.info(`burn tx: ${JSON.stringify(signedTx, null, 2)}`);
      burnTxHash = await ckb.rpc.sendTransaction(signedTx);
      console.log(`burn Transaction has been sent with tx hash ${burnTxHash}`);
      await waitUntilCommitted(ckb, burnTxHash, 60);
      sendBurn = true;
      expectBalanceAfterBurn = recipientBalance - burnAmount.toBigInt();
    }
    logger.info('expect recipient balance after burn:', expectBalanceAfterBurn);
    logger.info('recipient onchain balance after burn:', recipientBalance);
    assert(recipientBalance === expectBalanceAfterBurn);

    // check unlock record send
    const ethUnlockRecords = await conn.manager.find(EthUnlock, {
      where: {
        ckbTxHash: burnTxHash,
      },
    });
    assert(ethUnlockRecords.length === 1);
    const ethUnlockRecord = ethUnlockRecords[0];
    assert(ethUnlockRecord.status === 'success');
    const unlockReceipt = await provider.getTransactionReceipt(ethUnlockRecord.ethTxHash);
    logger.info('unlockReceipt', unlockReceipt);
    assert(unlockReceipt.logs.length === 1);

    const recipientParsedLog = iface.parseLog(unlockReceipt.logs[0]);
    const expectRecipientUnlockAmount = new Amount(burnAmount.toString(), 0).sub(new Amount(bridgeFee.out, 0));
    logger.info('recipient parsedLog', recipientParsedLog);
    assert(recipientParsedLog.args.token === ethUnlockRecord.asset);
    logger.info('db unlock amount', ethUnlockRecord.amount);
    logger.info('parsedLog recipient amount', recipientParsedLog.args.receivedAmount.toString());
    logger.info('expect recipient amount', expectRecipientUnlockAmount.toString(0));
    assert(expectRecipientUnlockAmount.toString(0) === recipientParsedLog.args.receivedAmount.toString());
    logger.info('db unlock recipient', ethUnlockRecord.recipientAddress);
    logger.info('parsedLog recipient', recipientParsedLog.args.recipient);
    assert(ethUnlockRecord.recipientAddress === recipientParsedLog.args.recipient);

    const builder = new reconc.EthReconcilerBuilder(reconc.createTwoWayRecordObservable());

    const lockReconc = await builder
      .buildLockReconciler('0x0000000000000000000000000000000000000000')
      .fetchReconciliation();

    logger.info('all locked', lockReconc.from);
    logger.info('all minted', lockReconc.to);

    assert(lockReconc.checkBalanced(), 'the amount of lock and mint should be balanced');

    const unlockReconciler = builder.buildUnlockReconciler('0x0000000000000000000000000000000000000000');
    const unlockBalancer = await unlockReconciler.fetchReconciliation();

    logger.info('all burned', unlockBalancer.from);
    logger.info('all unlocked', unlockBalancer.to);

    assert(unlockBalancer.checkBalanced(), 'the amount of burn and unlock should be balanced');
  };

  // try 100 times and wait for 3 seconds every time.
  for (let i = 0; i < 100; i++) {
    await asyncSleep(3000);
    try {
      await checkEffect();
    } catch (e) {
      logger.warn(`The eth component integration not pass yet. i:${i} error:${e.toString()}, stack: ${e.stack}`);
      continue;
    }
    logger.info('The eth component integration test pass!');
    return;
  }
  throw new Error('The eth component integration test failed!');
}

async function _burn() {
  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const conf: Config = nconf.get('forceBridge');
  const config: EthConfig = conf.eth;
  conf.common.log.logFile = './log/eth-ci.log';
  await bootstrap(conf);
  logger.info('config', config);
  const recipientAddress = '0x1000000000000000000000000000000000000001';
  const recipientFromLockscript = parseAddress(RECIPIENT_ADDR);
  const burnAmount = ethers.utils.parseEther('0.01');
  const ownerTypeHash = getOwnerTypeHash();
  const generator = new CkbTxGenerator(ckb, indexer);
  const burnTx = await generator.burn(
    recipientFromLockscript,
    recipientAddress,
    new EthAsset('0x0000000000000000000000000000000000000000', ownerTypeHash),
    // Amount.fromUInt128LE('0x01'),
    burnAmount.toBigInt(),
  );
  const signedTx = ckb.signTransaction(RECIPIENT_PRI_KEY)(burnTx);
  logger.info(`burn tx: ${JSON.stringify(signedTx, null, 2)}`);
  const burnTxHash = await ckb.rpc.sendTransaction(signedTx);
  console.log(`burn Transaction has been sent with tx hash ${burnTxHash}`);
  await waitUntilCommitted(ckb, burnTxHash, 60);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
