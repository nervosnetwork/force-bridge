import 'module-alias/register';
import { ethers } from 'ethers';
import nconf from 'nconf';
import { Config, EthConfig } from '@force-bridge/config';
import { initLog, logger } from '@force-bridge/utils/logger';
import { asyncSleep, parsePrivateKey, stringToUint8Array, toHexString, uint8ArrayToString } from '@force-bridge/utils';
import { createConnection } from 'typeorm';
import { ETH_ADDRESS } from '@force-bridge/xchain/eth';
import { CkbMint, EthLock, EthUnlock } from '@force-bridge/db/model';
import assert from 'assert';
import { ChainType, EthAsset } from '@force-bridge/ckb/model/asset';
import { abi } from '@force-bridge/xchain/eth/abi/ForceBridge.json';
import { Amount, Script } from '@lay2/pw-core';
import { Account } from '@force-bridge/ckb/model/accounts';
import { CkbTxGenerator } from '@force-bridge/ckb/tx-helper/generator';
import { IndexerCollector } from '@force-bridge/ckb/tx-helper/collector';
import { waitUntilCommitted } from './util';
import { ForceBridgeCore } from '@force-bridge/core';
import { CkbIndexer } from '@force-bridge/ckb/tx-helper/indexer';
import { getMultisigLock } from '@force-bridge/ckb/tx-helper/multisig/multisig_helper';
// import { multisigLockScript } from '@force-bridge/ckb/tx-helper/multisig/multisig_helper';

const CKB = require('@nervosnetwork/ckb-sdk-core').default;
const CKB_URL = process.env.CKB_URL || 'http://127.0.0.1:8114';
const indexer = new CkbIndexer('http://127.0.0.1:8114', 'http://127.0.0.1:8116');
const collector = new IndexerCollector(indexer);
const ckb = new CKB(CKB_URL);

async function main() {
  const conn = await createConnection();
  const PRI_KEY = process.env.PRI_KEY || '0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe';

  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const config: EthConfig = nconf.get('forceBridge:eth');
  const conf: Config = nconf.get('forceBridge');
  conf.common.log.logFile = './log/eth-ci.log';
  initLog(conf.common.log);

  logger.debug('config', config);
  // init bridge force core
  await new ForceBridgeCore().init(conf);
  const provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
  const bridgeContractAddr = config.contractAddress;
  const bridge = new ethers.Contract(bridgeContractAddr, abi, provider);
  const wallet = new ethers.Wallet(parsePrivateKey(config.privateKey), provider);
  const bridgeWithSigner = bridge.connect(wallet);
  const iface = new ethers.utils.Interface(abi);

  // lock eth
  const recipientLockscript = stringToUint8Array('ckt1qyqyph8v9mclls35p6snlaxajeca97tc062sa5gahk');
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
    logger.info('ethLockRecords', ethLockRecord.recipient);
    logger.info('ethLockRecords', `0x${toHexString(recipientLockscript)}`);
    assert(ethLockRecord.recipient === `${uint8ArrayToString(recipientLockscript)}`);

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
    assert(ckbMintRecord.amount === amount.toString());
    assert(ckbMintRecord.recipientLockscript === `${uint8ArrayToString(recipientLockscript)}`);

    // check sudt balance.
    const account = new Account(PRI_KEY);
    // const ownLockHash = ckb.utils.scriptToHash(<CKBComponents.Script>await account.getLockscript());
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
    const balance = await collector.getSUDTBalance(
      new Script(sudtType.codeHash, sudtType.args, sudtType.hashType),
      await account.getLockscript(),
    );

    if (!sendBurn) {
      logger.info('sudt balance:', balance);
      logger.info('expect balance:', new Amount(amount.toString(), 0));
      assert(balance.eq(new Amount(amount.toString(), 0)));
    }

    // send burn tx
    const burnAmount = ethers.utils.parseEther('0.01');
    if (!sendBurn) {
      const account = new Account(PRI_KEY);
      // const ownLockHash = ckb.utils.scriptToHash(<CKBComponents.Script>await account.getLockscript());
      const generator = new CkbTxGenerator(ckb, new IndexerCollector(indexer));
      const burnTx = await generator.burn(
        await account.getLockscript(),
        recipientAddress,
        new EthAsset('0x0000000000000000000000000000000000000000', ownLockHash),
        // Amount.fromUInt128LE('0x01'),
        new Amount(burnAmount.toString(), 0),
      );
      const signedTx = ckb.signTransaction(PRI_KEY)(burnTx);
      burnTxHash = await ckb.rpc.sendTransaction(signedTx);
      console.log(`burn Transaction has been sent with tx hash ${burnTxHash}`);
      await waitUntilCommitted(ckb, burnTxHash, 60);
      sendBurn = true;
    }
    const expectBalance = new Amount(amount.toString(), 0).sub(new Amount(burnAmount.toString(), 0));
    logger.info('sudt balance:', balance);
    logger.info('expect balance:', expectBalance);
    assert(balance.eq(expectBalance));

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
    const parsedLog = iface.parseLog(unlockReceipt.logs[0]);
    logger.info('parsedLog', parsedLog);
    assert(parsedLog.args.token === ethUnlockRecord.asset);
    logger.info('parsedLog amount', ethUnlockRecord.amount);
    logger.info('parsedLog amount', parsedLog.args.receivedAmount.toString());
    assert(ethUnlockRecord.amount === parsedLog.args.receivedAmount.toString());
    logger.info('parsedLog recipient', ethUnlockRecord.recipientAddress);
    logger.info('parsedLog recipient', parsedLog.args.recipient);
    assert(ethUnlockRecord.recipientAddress === parsedLog.args.recipient);
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
