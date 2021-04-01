import 'module-alias/register';
import { ethers } from 'ethers';
import nconf from 'nconf';
import { Config, EthConfig } from '@force-bridge/config';
import { logger } from '@force-bridge/utils/logger';
import { asyncSleep } from '@force-bridge/utils';
import { createConnection } from 'typeorm';
import { CkbDb, EthDb } from '@force-bridge/db';
import { ETH_ADDRESS } from '@force-bridge/xchain/eth';
import { CkbMint, EthLock, EthUnlock } from '@force-bridge/db/model';
import assert from 'assert';
import { ChainType, EthAsset } from '@force-bridge/ckb/model/asset';
import { abi } from '@force-bridge/xchain/eth/abi/ForceBridge.json';
import { Address, AddressType, Amount, Script } from '@lay2/pw-core';
import { Account } from '@force-bridge/ckb/model/accounts';
import { CkbTxGenerator } from '@force-bridge/ckb/tx-helper/generator';
import { IndexerCollector } from '@force-bridge/ckb/tx-helper/collector';
// import {CkbIndexer} from "@force-bridge/ckb/tx-helper/indexer";
import { ForceBridgeCore } from '@force-bridge/core';
import { CkbIndexer } from '@force-bridge/ckb/tx-helper/indexer';

const CKB = require('@nervosnetwork/ckb-sdk-core').default;
// const { Indexer, CellCollector } = require('@ckb-lumos/indexer');
const CKB_URL = process.env.CKB_URL || 'http://127.0.0.1:8114';
// const LUMOS_DB = './lumos_db';
const indexer = new CkbIndexer('http://127.0.0.1:8116');
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
  // const record = {
  //   ckbTxHash: genRandomHex(32),
  //   asset: ETH_ADDRESS,
  //   amount: genRandomHex(4),
  //   recipientAddress,
  // };
  // await ckbDb.createEthUnlock([record]);
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
    assert(ethLockRecord.amount === amount.toHexString());
    logger.debug('ethLockRecords', ethLockRecord.recipientLockscript);
    logger.debug('ethLockRecords', `0x${toHexString(recipientLockscript)}`);
    assert(ethLockRecord.recipientLockscript === `0x${toHexString(recipientLockscript)}`);

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
    assert(ckbMintRecord.amount === amount.toHexString());
    assert(ckbMintRecord.recipientLockscript === `0x${toHexString(recipientLockscript)}`);

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
      logger.debug('sudt balance:', balance.toHexString());
      logger.debug('expect balance:', Amount.fromUInt128LE(amount.toHexString()).toHexString());
      assert(balance.eq(Amount.fromUInt128LE(amount.toHexString())));
    }

    // send burn tx
    if (!sendBurn) {
      const account = new Account(PRI_KEY);
      const ownLockHash = ckb.utils.scriptToHash(<CKBComponents.Script>await account.getLockscript());
      const generator = new CkbTxGenerator(ckb, new IndexerCollector(indexer));
      const burnTx = await generator.burn(
        await account.getLockscript(),
        recipientAddress,
        new EthAsset('0x0000000000000000000000000000000000000000', ownLockHash),
        Amount.fromUInt128LE('0x01'),
      );
      const signedTx = ckb.signTransaction(PRI_KEY)(burnTx);
      burnTxHash = await ckb.rpc.sendTransaction(signedTx);
      console.log(`burn Transaction has been sent with tx hash ${burnTxHash}`);
      await waitUntilCommitted(burnTxHash, 60);
      sendBurn = true;
    }
    logger.debug('sudt balance:', balance.toHexString());
    logger.debug(
      'expect balance:',
      Amount.fromUInt128LE(amount.toHexString()).sub(Amount.fromUInt128LE('0x01')).toHexString(),
    );
    assert(balance.eq(Amount.fromUInt128LE(amount.toHexString()).sub(Amount.fromUInt128LE('0x01'))));

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
    logger.debug('parsedLog amount', parsedLog.args.receivedAmount.toHexString());
    assert(ethUnlockRecord.amount === parsedLog.args.receivedAmount.toHexString());
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

async function waitUntilCommitted(txHash, timeout) {
  let waitTime = 0;
  while (true) {
    const txStatus = await ckb.rpc.getTransaction(txHash);
    console.log(`tx ${txHash} status: ${txStatus.txStatus.status}, index: ${waitTime}`);
    if (txStatus.txStatus.status === 'committed') {
      return txStatus;
    }
    await sleep(1000);
    waitTime += 1;
    if (waitTime >= timeout) {
      return txStatus;
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

function stringToUint8Array(str): Uint8Array {
  const arr = [];
  for (let i = 0, j = str.length; i < j; ++i) {
    arr.push(str.charCodeAt(i));
  }
  const tmpUint8Array = new Uint8Array(arr);
  return tmpUint8Array;
}

function uint8ArrayToString(fileData): string {
  let dataString = '';
  for (let i = 0; i < fileData.length; i++) {
    dataString += String.fromCharCode(fileData[i]);
  }
  return dataString;
}

const fromHexString = (hexString) => new Uint8Array(hexString.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));

const toHexString = (bytes) => bytes.reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '');
