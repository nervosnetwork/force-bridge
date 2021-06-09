import assert from 'assert';
import { CKBIndexerClient } from '@force-bridge/ckb-indexer-client';
import { Account } from '@force-bridge/x/dist/ckb/model/accounts';
import { ChainType, EthAsset } from '@force-bridge/x/dist/ckb/model/asset';
import { IndexerCollector } from '@force-bridge/x/dist/ckb/tx-helper/collector';
import { CkbTxGenerator } from '@force-bridge/x/dist/ckb/tx-helper/generator';
// import {CkbIndexer} from "@force-bridge/x/dist/ckb/tx-helper/indexer";
import { CkbIndexer } from '@force-bridge/x/dist/ckb/tx-helper/indexer';
import { getMultisigLock } from '@force-bridge/x/dist/ckb/tx-helper/multisig/multisig_helper';
import { Config, EthConfig } from '@force-bridge/x/dist/config';
import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { EthDb } from '@force-bridge/x/dist/db/eth';
import { CkbMint, EthLock, EthUnlock } from '@force-bridge/x/dist/db/model';
import {
  asyncSleep,
  getDBConnection,
  parsePrivateKey,
  stringToUint8Array,
  toHexString,
  uint8ArrayToString,
} from '@force-bridge/x/dist/utils';
import { logger, initLog } from '@force-bridge/x/dist/utils/logger';
import { ETH_ADDRESS } from '@force-bridge/x/dist/xchain/eth';
import { abi } from '@force-bridge/x/dist/xchain/eth/abi/ForceBridge.json';
import { EthReconcilerBuilder, ForceBridgeContract } from '@force-bridge/xchain-eth';
import { Amount, Script } from '@lay2/pw-core';
import CKB from '@nervosnetwork/ckb-sdk-core';
import { ethers } from 'ethers';
import nconf from 'nconf';
import { waitUntilCommitted } from './util';
// const { Indexer, CellCollector } = require('@ckb-lumos/sql-indexer');
const CKB_URL = process.env.CKB_URL || 'http://127.0.0.1:8114';
const CKB_INDEXER_URL = process.env.CKB_INDEXER_URL || 'http://127.0.0.1:8116';
// const LUMOS_DB = './lumos_db';
const indexer = new CkbIndexer(CKB_URL, CKB_INDEXER_URL);
const collector = new IndexerCollector(indexer);

const ckb = new CKB(CKB_URL);
const RELAY_PRI_KEY = process.env.PRI_KEY || '0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe';
const ETH_PRI_KEY = process.env.ETH_PRI_KEY || '0xc4ad657963930fbff2e9de3404b30a4e21432c89952ed430b56bf802945ed37a';

async function main() {
  // ckb account to recieve ckETH and send burn tx
  const RECIPIENT_PRI_KEY = '0xd00c06bfd800d27397002dca6fb0993d5ba6399b4238b2f29ee9deb97593d2bc';
  const RECIPIENT_ADDR = 'ckt1qyqvsv5240xeh85wvnau2eky8pwrhh4jr8ts8vyj37';

  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const conf: Config = nconf.get('forceBridge');
  const config: EthConfig = conf.eth;
  conf.common.log.logFile = './log/eth-ci.log';
  initLog(conf.common.log);

  logger.info('config', config);

  // init bridge force core
  await new ForceBridgeCore().init(conf);
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

  // create eth unlock
  const recipientAddress = '0x1000000000000000000000000000000000000001';
  const balanceBefore = await provider.getBalance(recipientAddress);
  logger.info('balanceBefore burn', balanceBefore);

  let sendBurn = false;
  let burnTxHash;
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
    const account = new Account(RECIPIENT_PRI_KEY);
    const multisigLockScript = getMultisigLock(ForceBridgeCore.config.ckb.multisigScript);
    const ownLockHash = ckb.utils.scriptToHash(<CKBComponents.Script>{
      codeHash: multisigLockScript.code_hash,
      hashType: multisigLockScript.hash_type,
      args: multisigLockScript.args,
    });
    const asset = new EthAsset('0x0000000000000000000000000000000000000000', ownLockHash);
    const bridgeCellLockscript = {
      codeHash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
      hashType: ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
      args: asset.toBridgeLockscriptArgs(),
    };
    const sudtArgs = ckb.utils.scriptToHash(<CKBComponents.Script>bridgeCellLockscript);
    const sudtType = {
      codeHash: ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash,
      hashType: ForceBridgeCore.config.ckb.deps.sudtType.script.hashType,
      args: sudtArgs,
    };
    const recipientBalance = await collector.getSUDTBalance(
      new Script(sudtType.codeHash, sudtType.args, sudtType.hashType),
      await account.getLockscript(),
    );

    if (!sendBurn) {
      logger.info('recipient sudt balance on chain:', recipientBalance);
      const expectBalance = new Amount(mintAmount, 0);
      logger.info('expect recipient balance:', expectBalance);
      assert(recipientBalance.eq(expectBalance));
    }

    // send burn tx
    const burnAmount = ethers.utils.parseEther('0.01');
    if (!sendBurn) {
      const generator = new CkbTxGenerator(ckb, indexer);
      const burnTx = await generator.burn(
        await new Account(RECIPIENT_PRI_KEY).getLockscript(),
        recipientAddress,
        new EthAsset('0x0000000000000000000000000000000000000000', ownLockHash),
        // Amount.fromUInt128LE('0x01'),
        new Amount(burnAmount.toString(), 0),
      );
      const signedTx = ckb.signTransaction(RECIPIENT_PRI_KEY)(burnTx);
      burnTxHash = await ckb.rpc.sendTransaction(signedTx);
      console.log(`burn Transaction has been sent with tx hash ${burnTxHash}`);
      await waitUntilCommitted(ckb, burnTxHash, 60);
      sendBurn = true;
    }
    const expectBalanceAfterBurn = new Amount(ckbMintRecord.amount, 0).sub(new Amount(burnAmount.toString(), 0));
    logger.info('expect recipient balance after burn:', expectBalanceAfterBurn);
    logger.info('recipient onchain balance after burn:', recipientBalance);
    assert(recipientBalance.eq(expectBalanceAfterBurn));

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

    const builder = new EthReconcilerBuilder(
      provider,
      bridge,
      new EthDb(conn),
      new CKBIndexerClient(CKB_INDEXER_URL),
      ckb.rpc,
    );
    const lockReconc = await builder
      .buildLockReconciler(wallet.address, '0x0000000000000000000000000000000000000000')
      .fetchReconciliation();

    logger.info('all locked', lockReconc.from);
    logger.info('all minted', lockReconc.to);

    assert(lockReconc.checkBalanced(), 'the amount of lock and mint should be balanced');

    const unlockReconc = await builder
      .buildUnlockReconciler(uint8ArrayToString(recipientLockscript), '0x0000000000000000000000000000000000000000')
      .fetchReconciliation();

    logger.info('all burned', unlockReconc.from);
    logger.info('all unlocked', unlockReconc.to);

    assert(unlockReconc.checkBalanced(), 'the amount of burn and unlock should be balanced');
  };

  // try 100 times and wait for 3 seconds every time.
  for (let i = 0; i < 100; i++) {
    await asyncSleep(3000);
    try {
      await checkEffect();
    } catch (e) {
      logger.warn(`The eth component integration not pass yet. i:${i} error:${e.toString()}`);
      continue;
    }
    logger.info('The eth component integration test pass!');
    return;
  }
  throw new Error('The eth component integration test failed!');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
