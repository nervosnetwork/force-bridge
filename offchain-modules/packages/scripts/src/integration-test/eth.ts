import 'module-alias/register';
import { ethers } from 'ethers';
import nconf from 'nconf';
import { Config, EthConfig } from '@force-bridge/x/dist/config';
import { logger } from '@force-bridge/x/dist/utils/logger';
import {
  asyncSleep,
  fromHexString,
  stringToUint8Array,
  toHexString,
  uint8ArrayToString,
} from '@force-bridge/x/dist/utils';
import { createConnection } from 'typeorm';
import { CkbDb, EthDb } from '@force-bridge/x/dist/db';
import { ETH_ADDRESS } from '@force-bridge/x/dist/xchain/eth';
import { CkbMint, EthLock, EthUnlock } from '@force-bridge/x/dist/db/model';
import assert from 'assert';
import { ChainType, EthAsset } from '@force-bridge/x/dist/ckb/model/asset';
import { abi } from '@force-bridge/x/dist/xchain/eth/abi/ForceBridge.json';
import { Address, AddressType, Amount, Script } from '@lay2/pw-core';
import { Account } from '@force-bridge/x/dist/ckb/model/accounts';
import { CkbTxGenerator } from '@force-bridge/x/dist/ckb/tx-helper/generator';
import { IndexerCollector } from '@force-bridge/x/dist/ckb/tx-helper/collector';
import { waitUntilCommitted } from './util';
// import {CkbIndexer} from "@force-bridge/x/dist/ckb/tx-helper/indexer";
import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { CkbIndexer } from '@force-bridge/x/dist/ckb/tx-helper/indexer';

const CKB = require('@nervosnetwork/ckb-sdk-core').default;
// const { Indexer, CellCollector } = require('@ckb-lumos/indexer');
const CKB_URL = process.env.CKB_URL || 'http://127.0.0.1:8114';
const CKB_INDEXER_URL = process.env.CKB_INDEXER_URL || 'http://127.0.0.1:8116';
// const LUMOS_DB = './lumos_db';
const indexer = new CkbIndexer(CKB_URL, CKB_INDEXER_URL);
const collector = new IndexerCollector(indexer);
// indexer.startForever();
const ckb = new CKB(CKB_URL);

async function main() {
  const conn = await createConnection();
  const ethDb = new EthDb(conn);
  const ckbDb = new CkbDb(conn);
  const PRI_KEY = process.env.PRI_KEY || '0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe';

  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const config: EthConfig = nconf.get('forceBridge:eth');
  logger.debug('config', config);
  const conf: Config = nconf.get('forceBridge');
  // init bridge force core
  await new ForceBridgeCore().init(conf);
  // const ForceBridge = await ethers.getContractFactory("ForceBridge");
  // const bridge = await ForceBridge.deploy();
  // await bridge.deployed();
  // console.log("ForceBridge deployed to:", bridge.address);
  const provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
  // const blockNumber = await provider.getBlockNumber();
  // logger.debug('blockNumber:', blockNumber);
  const bridgeContractAddr = config.contractAddress;
  // logger.debug('bridgeContractAddr:', bridgeContractAddr);
  // const signer = provider.getSigner()
  // logger.debug('signer:', signer);
  // logger.debug('abi:', abi);
  const bridge = new ethers.Contract(bridgeContractAddr, abi, provider);
  const wallet = new ethers.Wallet(config.privateKey, provider);
  const bridgeWithSigner = bridge.connect(wallet);
  const iface = new ethers.utils.Interface(abi);

  // listen
  // bridgeWithSigner.on("Locked", (token, sender, lockedAmount, recipientLockscript, sudtExtraData) => {
  //     logger.debug('event:', {token, sender, lockedAmount, recipientLockscript, sudtExtraData});
  // });
  // const filter = {
  //   address: bridgeContractAddr,
  //   fromBlock: 0,
  //   // fromBlock: 'earliest',
  //   topics: [
  //     // the name of the event, parnetheses containing the data type of each event, no spaces
  //     // utils.id("Transfer(address,address,uint256)")
  //     ethers.utils.id('Locked(address,address,uint256,bytes,bytes)'),
  //   ],
  // };
  // // provider.resetEventsBlock(0)
  // provider.on(filter, async (log) => {
  //   const parsedLog = iface.parseLog(log);
  //   logger.debug('log:', { log, parsedLog });
  //   // do whatever you want here
  //   // I'm pretty sure this returns a promise, so don't forget to resolve it
  // });
  // lock eth
  const recipientLockscript = stringToUint8Array('ckt1qyqyph8v9mclls35p6snlaxajeca97tc062sa5gahk');
  logger.debug('recipientLockscript', toHexString(recipientLockscript));
  const sudtExtraData = '0x01';
  const amount = ethers.utils.parseEther('0.1');
  logger.debug('amount', amount);
  const lockRes = await bridgeWithSigner.lockETH(recipientLockscript, sudtExtraData, { value: amount });
  logger.debug('lockRes', lockRes);
  const txHash = lockRes.hash;
  const receipt = await lockRes.wait();
  logger.debug('receipt', receipt);

  // create eth unlock
  const recipientAddress = '0x1000000000000000000000000000000000000001';
  const balanceBefore = await provider.getBalance(recipientAddress);
  logger.debug('balanceBefore', balanceBefore);

  let sendBurn = false;
  let burnTxHash;
  const checkEffect = async () => {
    // check EthLock and CkbMint saved.
    const ethLockRecords = await conn.manager.find(EthLock, {
      where: {
        txHash,
      },
    });

    logger.debug('ethLockRecords', ethLockRecords);
    assert(ethLockRecords.length === 1);
    const ethLockRecord = ethLockRecords[0];
    assert(ethLockRecord.sudtExtraData === sudtExtraData);
    assert(ethLockRecord.sender === wallet.address);
    assert(ethLockRecord.token === ETH_ADDRESS);
    assert(ethLockRecord.amount === amount.toString());
    logger.debug('ethLockRecords', ethLockRecord.recipient);
    logger.debug('ethLockRecords', `0x${toHexString(recipientLockscript)}`);
    assert(ethLockRecord.recipient === `${uint8ArrayToString(recipientLockscript)}`);

    const ckbMintRecords = await conn.manager.find(CkbMint, {
      where: {
        id: txHash,
      },
    });
    logger.debug('ckbMintRecords', ckbMintRecords);
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
    const ownLockHash = ckb.utils.scriptToHash(<CKBComponents.Script>await account.getLockscript());
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
      logger.debug('sudt balance:', balance);
      logger.debug('expect balance:', new Amount(amount.toString(), 0));
      assert(balance.eq(new Amount(amount.toString(), 0)));
    }

    // send burn tx
    const burnAmount = ethers.utils.parseEther('0.01');
    if (!sendBurn) {
      const account = new Account(PRI_KEY);
      const ownLockHash = ckb.utils.scriptToHash(<CKBComponents.Script>await account.getLockscript());
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
    logger.debug('sudt balance:', balance);
    logger.debug('expect balance:', expectBalance);
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
    logger.debug('unlockReceipt', unlockReceipt);
    assert(unlockReceipt.logs.length === 1);
    const parsedLog = iface.parseLog(unlockReceipt.logs[0]);
    logger.debug('parsedLog', parsedLog);
    assert(parsedLog.args.token === ethUnlockRecord.asset);
    logger.debug('parsedLog amount', ethUnlockRecord.amount);
    logger.debug('parsedLog amount', parsedLog.args.receivedAmount.toString());
    assert(ethUnlockRecord.amount === parsedLog.args.receivedAmount.toString());
    logger.debug('parsedLog recipient', ethUnlockRecord.recipientAddress);
    logger.debug('parsedLog recipient', parsedLog.args.recipient);
    assert(ethUnlockRecord.recipientAddress === parsedLog.args.recipient);
  };

  // try 100 times and wait for 3 seconds every time.
  for (let i = 0; i < 100; i++) {
    await asyncSleep(3000);
    try {
      await checkEffect();
    } catch (e) {
      logger.warn('The eth component integration not pass yet.', { i, e });
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
