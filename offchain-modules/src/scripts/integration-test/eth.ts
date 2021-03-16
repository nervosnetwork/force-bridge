import 'module-alias/register';
import { ethers } from 'ethers';
import nconf from 'nconf';
import { Config, EthConfig } from '@force-bridge/config';
import { logger } from '@force-bridge/utils/logger';
import { asyncSleep, genRandomHex } from '@force-bridge/utils';
import { createConnection } from 'typeorm';
import { CkbDb, EthDb } from '@force-bridge/db';
import { ETH_ADDRESS } from '@force-bridge/xchain/eth';
import { CkbMint, EthLock, EthUnlock } from '@force-bridge/db/model';
import assert from 'assert';
import { ChainType } from '@force-bridge/ckb/model/asset';

async function main() {
  const conn = await createConnection();
  const ethDb = new EthDb(conn);
  const ckbDb = new CkbDb(conn);

  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const config: EthConfig = nconf.get('forceBridge:eth');
  logger.debug('config', config);
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
  const abi = require('../../../../eth-contracts/artifacts/contracts/ForceBridge.sol/ForceBridge.json').abi;
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
  const recipientLockscript = '0x00';
  const sudtExtraData = '0x01';
  const amount = ethers.utils.parseEther('0.1');
  const lockRes = await bridgeWithSigner.lockETH(recipientLockscript, sudtExtraData, { value: amount });
  logger.debug('lockRes', lockRes);
  const txHash = lockRes.hash;
  const receipt = await lockRes.wait();
  logger.debug('receipt', receipt);

  // create eth unlock
  const recipientAddress = '0x1000000000000000000000000000000000000001';
  const balanceBefore = await provider.getBalance(recipientAddress);
  logger.debug('balanceBefore', balanceBefore);
  const record = {
    ckbTxHash: genRandomHex(32),
    asset: ETH_ADDRESS,
    amount: genRandomHex(4),
    recipientAddress,
  };
  await ckbDb.createEthUnlock([record]);

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
    assert(ethLockRecord.recipientLockscript === recipientLockscript);

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
    assert(ckbMintRecord.status === 'todo');
    assert(ckbMintRecord.asset === ETH_ADDRESS);
    assert(ckbMintRecord.amount === amount.toHexString());
    assert(ckbMintRecord.recipientLockscript === recipientLockscript);

    // check unlock record send
    const ethUnlockRecords = await conn.manager.find(EthUnlock, {
      where: {
        ckbTxHash: record.ckbTxHash,
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
    assert(parsedLog.args.token === record.asset);
    assert(record.amount === parsedLog.args.receivedAmount.toHexString());
    assert(record.recipientAddress === parsedLog.args.recipient);
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
