import { IndexerCollector } from '@force-bridge/x/dist/ckb/tx-helper/collector';
import { CkbIndexer } from '@force-bridge/x/dist/ckb/tx-helper/indexer';
import { Config } from '@force-bridge/x/dist/config';
import { asserts } from '@force-bridge/x/dist/errors';
import { asyncSleep } from '@force-bridge/x/dist/utils';
import { initLog, logger } from '@force-bridge/x/dist/utils/logger';
import { Script, Amount } from '@lay2/pw-core';
import CKB from '@nervosnetwork/ckb-sdk-core/';
import { AddressPrefix } from '@nervosnetwork/ckb-sdk-utils';

import { ethers } from 'ethers';
import { JSONRPCClient } from 'json-rpc-2.0';
import nconf from 'nconf';
import fetch from 'node-fetch/index';

const BATCH_NUM = 100;
const LOCK_AMOUNT = '2000000000000000';
const BURN_AMOUNT = '1000000000000000';
const ETH_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000';

const FORCE_BRIDGE_URL = process.env.FORCE_BRIDGE_RPC_URL || 'http://127.0.0.1:8080/force-bridge/api/v1';

const ETH_NODE_URL = process.env.ETH_URL || 'http://127.0.0.1:8545';
const ETH_PRI = process.env.ETH_PRIV_KEY || '0xc4ad657963930fbff2e9de3404b30a4e21432c89952ed430b56bf802945ed37a';

const CKB_NODE_URL = process.env.CKB_URL || 'http://127.0.0.1:8114';
const CKB_INDEXER_URL = process.env.CKB_INDEXER_URL || 'http://127.0.0.1:8116';
const CKB_PRI = process.env.CKB_PRIV_KEY || '0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe';

// const FORCE_BRIDGE_URL = 'XXX';

// const ETH_NODE_URL = 'XXX';
// const ETH_PRI = 'XXX';

// const CKB_NODE_URL = 'https://testnet.ckbapp.dev';
// const CKB_INDEXER_URL = 'https://testnet.ckbapp.dev/indexer';
// const CKB_PRI = 'XXX';

const ckb = new CKB(CKB_NODE_URL);

const client = new JSONRPCClient((jsonRPCRequest) =>
  fetch(FORCE_BRIDGE_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(jsonRPCRequest),
    id: 1,
  }).then((response) => {
    if (response.status === 200) {
      // Use client.receive when you received a JSON-RPC response.
      return response.json().then((jsonRPCResponse) => client.receive(jsonRPCResponse));
    } else if (jsonRPCRequest.id !== undefined) {
      return Promise.reject(new Error(response.statusText));
    }
  }),
);

async function generateLockTx(
  ethWallet: ethers.Wallet,
  assetIdent: string,
  nonce: number,
  recipient: string,
  amount: string,
): Promise<string> {
  const lockPayload = {
    sender: ethWallet.address,
    recipient: recipient,
    asset: {
      network: 'Ethereum',
      ident: assetIdent,
      amount: amount,
    },
  };
  const unsignedLockTx = await client.request('generateBridgeInNervosTransaction', lockPayload);
  logger.info('unsignedMintTx', unsignedLockTx);

  const provider = new ethers.providers.JsonRpcProvider(ETH_NODE_URL);

  const unsignedTx = unsignedLockTx.rawTransaction;
  unsignedTx.value = unsignedTx.value ? ethers.BigNumber.from(unsignedTx.value.hex) : ethers.BigNumber.from(0);
  unsignedTx.nonce = nonce;
  unsignedTx.gasLimit = ethers.BigNumber.from(1000000);
  unsignedTx.gasPrice = await provider.getGasPrice();

  logger.info('unsignedTx', unsignedTx);

  const signedTx = await ethWallet.signTransaction(unsignedTx);
  logger.info('signedTx', signedTx);

  const hexTx = await Promise.resolve(signedTx).then((t) => ethers.utils.hexlify(t));
  return hexTx;
}

async function generateBurnTx(
  asset: string,
  ckbPriv: string,
  sender: string,
  recipient: string,
  amount: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const burnPayload = {
    network: 'Ethereum',
    sender: sender,
    recipient: recipient,
    asset: asset,
    amount: amount,
  };

  for (let i = 0; i < 5; i++) {
    try {
      const unsignedBurnTx = await client.request('generateBridgeOutNervosTransaction', burnPayload);
      logger.info('unsignedBurnTx ', unsignedBurnTx);

      const signedTx = ckb.signTransaction(ckbPriv)(unsignedBurnTx.rawTransaction);
      logger.info('signedTx', signedTx);
      return signedTx;
    } catch (e) {
      if (i == 4) {
        throw e;
      }
      logger.error('generateBridgeOutNervosTransaction error', e);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getTransaction(assetIdent: string, userIdent: string): Promise<any> {
  const getTxPayload = {
    network: 'Ethereum',
    xchainAssetIdent: assetIdent,
    user: {
      network: 'Nervos',
      ident: userIdent,
    },
  };

  const txs = await client.request('getBridgeTransactionSummaries', getTxPayload);

  return txs;
}

async function checkTx(assetIdent: string, txId: string, userIdent: string) {
  let find = false;
  let pending = false;
  for (let i = 0; i < 600; i++) {
    const txs = await getTransaction(assetIdent, userIdent);
    for (const tx of txs) {
      if (tx.txSummary.fromTransaction.txId == txId) {
        logger.info('tx', tx);
      }
      if (tx.status == 'Successful' && tx.txSummary.fromTransaction.txId == txId) {
        find = true;
        pending = false;
        break;
      }
      if (tx.status == 'Failed' && tx.txSummary.fromTransaction.txId == txId) {
        throw new Error(`rpc test failed, ${txId} occurs error ${tx.message}`);
      }
      if (tx.status == 'Pending' && tx.txSummary.fromTransaction.txId == txId) {
        pending = true;
      }
    }
    if (find) {
      break;
    }
    await asyncSleep(3000);
  }
  if (pending) {
    throw new Error(`rpc test failed, pending for 3000s ${txId}`);
  }
  if (!find) {
    throw new Error(`rpc test failed, can not find record ${txId}`);
  }
}

async function lock(
  provider: ethers.providers.JsonRpcProvider,
  ethWallet: ethers.Wallet,
  recipients: Array<string>,
): Promise<Array<string>> {
  const signedLockTxs = new Array<string>();
  const lockTxHashes = new Array<string>();
  const startNonce = await ethWallet.getTransactionCount();

  for (let i = 0; i < BATCH_NUM; i++) {
    const signedLockTx = await generateLockTx(ethWallet, ETH_TOKEN_ADDRESS, startNonce + i, recipients[i], LOCK_AMOUNT);
    signedLockTxs.push(signedLockTx);
  }

  for (let i = 0; i < BATCH_NUM; i++) {
    const lockTxHash = (await provider.sendTransaction(signedLockTxs[i])).hash;
    lockTxHashes.push(lockTxHash);
  }
  logger.info('lock txs', lockTxHashes);
  return lockTxHashes;
}

async function burn(ckbPrivs: Array<string>, senders: Array<string>, recipient: string): Promise<Array<string>> {
  const burnTxHashes = new Array<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signedBurnTxs = new Array<any>();
  for (let i = 0; i < BATCH_NUM; i++) {
    const burnTx = await generateBurnTx(ETH_TOKEN_ADDRESS, ckbPrivs[i], senders[i], recipient, BURN_AMOUNT);
    signedBurnTxs.push(burnTx);
  }

  for (let i = 0; i < BATCH_NUM; i++) {
    const burnETHTxHash = await ckb.rpc.sendTransaction(signedBurnTxs[i]);
    burnTxHashes.push(burnETHTxHash);
  }
  logger.info('burn txs', burnTxHashes);
  return burnTxHashes;
}

async function check(txHashes: Array<string>, addresses: Array<string>) {
  for (let i = 0; i < BATCH_NUM; i++) {
    await checkTx(ETH_TOKEN_ADDRESS, txHashes[i], addresses[i]);
  }
}

function prepareCkbPrivateKeys(): Array<string> {
  const privateKeys = new Array<string>();
  for (let i = 0; i < BATCH_NUM; i++) {
    privateKeys.push(ethers.Wallet.createRandom().privateKey);
  }
  return privateKeys;
}

async function prepareCkbAddresses(privateKeys: Array<string>): Promise<Array<string>> {
  const { secp256k1Dep } = await ckb.loadDeps();
  asserts(secp256k1Dep);
  const cellDeps = [
    {
      outPoint: secp256k1Dep.outPoint,
      depType: secp256k1Dep.depType,
    },
  ];

  const publicKey = ckb.utils.privateKeyToPublicKey(CKB_PRI);
  const args = `0x${ckb.utils.blake160(publicKey, 'hex')}`;
  const fromLockscript = {
    code_hash: secp256k1Dep.codeHash,
    args,
    hash_type: secp256k1Dep.hashType,
  };
  asserts(fromLockscript);
  const needSupplyCap = BATCH_NUM * 600 * 100000000 + 100000;
  const collector = new IndexerCollector(new CkbIndexer(CKB_NODE_URL, CKB_INDEXER_URL));

  const needSupplyCapCells = await collector.getCellsByLockscriptAndCapacity(fromLockscript, BigInt(needSupplyCap));
  console.log(needSupplyCapCells);
  const inputs = needSupplyCapCells.map((cell) => {
    return { previousOutput: { txHash: cell.out_point!.tx_hash, index: cell.out_point!.index }, since: '0x0' };
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const outputs = new Array<any>();
  const outputsData = new Array<string>();
  const addresses = new Array<string>();
  for (const key of privateKeys) {
    const toPublicKey = ckb.utils.privateKeyToPublicKey(key);
    addresses.push(ckb.utils.pubkeyToAddress(toPublicKey, { prefix: AddressPrefix.Testnet }));

    const toArgs = `0x${ckb.utils.blake160(toPublicKey, 'hex')}`;
    const toScript = Script.fromRPC({
      code_hash: secp256k1Dep.codeHash,
      args: toArgs,
      hash_type: secp256k1Dep.hashType,
    });
    const capacity = 600 * 100000000;
    const toScriptCell = {
      lock: toScript,
      capacity: `0x${capacity.toString(16)}`,
    };
    outputs.push(toScriptCell);
    outputsData.push('0x');
  }

  const inputCap = needSupplyCapCells.map((cell) => BigInt(cell.cell_output.capacity)).reduce((a, b) => a + b);
  const outputCap = outputs.map((cell) => BigInt(cell.capacity)).reduce((a, b) => a + b);
  const changeCellCapacity = inputCap - outputCap - 100000n;
  console.log(changeCellCapacity);
  outputs.push({
    lock: fromLockscript,
    capacity: `0x${changeCellCapacity.toString(16)}`,
  });
  outputsData.push('0x');

  const rawTx = {
    version: '0x0',
    cellDeps,
    headerDeps: [],
    inputs,
    outputs,
    witnesses: [{ lock: '', inputType: '', outputType: '' }],
    outputsData,
  };

  const signedTx = ckb.signTransaction(CKB_PRI)(rawTx);
  logger.info('signedTx', signedTx);

  const burnTxHash = await ckb.rpc.sendTransaction(signedTx);
  logger.info('tx', burnTxHash);
  return addresses;
}

async function main() {
  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const conf: Config = nconf.get('forceBridge');
  conf.common.log.logFile = './log/rpc-ci.log';
  initLog(conf.common.log);

  const provider = new ethers.providers.JsonRpcProvider(ETH_NODE_URL);
  const ethWallet = new ethers.Wallet(ETH_PRI, provider);
  const ethAddress = ethWallet.address;

  const ckbPrivs = await prepareCkbPrivateKeys();
  const ckbAddresses = await prepareCkbAddresses(ckbPrivs);

  const lockTxs = await lock(provider, ethWallet, ckbAddresses);
  await check(lockTxs, ckbAddresses);

  const burnTxs = await burn(ckbPrivs, ckbAddresses, ethAddress);
  await check(burnTxs, ckbAddresses);
}

main().catch((error) => {
  logger.error(error);
  process.exit(1);
});
