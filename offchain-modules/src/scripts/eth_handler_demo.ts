import 'module-alias/register';
import { ethers } from 'ethers';
import nconf from 'nconf';
import { Config } from '@force-bridge/config';
import { logger } from '@force-bridge/utils/logger';
import { asyncSleep, genRandomHex } from '@force-bridge/utils';
import { createConnection } from 'typeorm';
import { CkbDb, EthDb } from '@force-bridge/db';
import { ETH_ADDRESS } from '@force-bridge/xchain/eth';

async function main() {
  const conn = await createConnection();
  const ethDb = new EthDb(conn);
  const ckbDb = new CkbDb(conn);

  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const config: Config = nconf.get('forceBridge');
  // const ForceBridge = await ethers.getContractFactory("ForceBridge");
  // const bridge = await ForceBridge.deploy();
  // await bridge.deployed();
  // console.log("ForceBridge deployed to:", bridge.address);
  const provider = new ethers.providers.JsonRpcProvider();
  // const blockNumber = await provider.getBlockNumber();
  // logger.debug('blockNumber:', blockNumber);
  const bridgeContractAddr = config.eth.contractAddress;
  // logger.debug('bridgeContractAddr:', bridgeContractAddr);
  // const signer = provider.getSigner()
  // logger.debug('signer:', signer);
  const abi = require('../../../eth-contracts/artifacts/contracts/ForceBridge.sol/ForceBridge.json').abi;
  logger.debug('abi:', abi);
  const bridge = new ethers.Contract(bridgeContractAddr, abi, provider);
  const privateKey = '0xc4ad657963930fbff2e9de3404b30a4e21432c89952ed430b56bf802945ed37a';
  const wallet = new ethers.Wallet(privateKey, provider);
  const bridgeWithSigner = bridge.connect(wallet);
  const iface = new ethers.utils.Interface(abi);

  // listen
  // bridgeWithSigner.on("Locked", (token, sender, lockedAmount, recipientLockscript, sudtExtraData) => {
  //     logger.debug('event:', {token, sender, lockedAmount, recipientLockscript, sudtExtraData});
  // });
  const filter = {
    address: bridgeContractAddr,
    fromBlock: 'earliest',
    topics: [
      // the name of the event, parnetheses containing the data type of each event, no spaces
      // utils.id("Transfer(address,address,uint256)")
      ethers.utils.id('Locked(address,address,uint256,bytes,bytes)'),
    ],
  };
  // provider.resetEventsBlock(0)
  // provider.on(filter, (log) => {
  //     const parsedLog = iface.parseLog(log);
  //     logger.debug('log:', {log, parsedLog});
  //     // do whatever you want here
  //     // I'm pretty sure this returns a promise, so don't forget to resolve it
  // })
  // lock
  const recipientLockscript = '0x00';
  const sudtExtraData = '0x01';
  const amount = ethers.utils.parseEther('0.1');
  const lockRes = await bridgeWithSigner.lockETH(recipientLockscript, sudtExtraData, { value: amount });
  logger.debug('lockRes', lockRes);
  const receipt = await lockRes.wait();
  logger.debug('receipt', receipt);

  // create eth unlock
  const record = {
    ckbTxHash: genRandomHex(32),
    asset: ETH_ADDRESS,
    amount: genRandomHex(4),
    recipientAddress: '0x1000000000000000000000000000000000000001',
  };
  await ckbDb.createEthUnlock([record]);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
