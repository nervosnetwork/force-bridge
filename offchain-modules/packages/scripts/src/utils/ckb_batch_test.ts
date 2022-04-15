import { Cell, utils } from '@ckb-lumos/base';
import { key } from '@ckb-lumos/hd';
import { objectToTransactionSkeleton, sealTransaction, minimalCellCapacity } from '@ckb-lumos/helpers';
import { RPC } from '@ckb-lumos/rpc';
import { IndexerCollector } from '@force-bridge/x/dist/ckb/tx-helper/collector';
import { CkbIndexer, ScriptType } from '@force-bridge/x/dist/ckb/tx-helper/indexer';
import { WhiteListNervosAsset, CKB_TYPESCRIPT_HASH, ConfigItem } from '@force-bridge/x/dist/config';
import { asserts } from '@force-bridge/x/dist/errors';
import { asyncSleep } from '@force-bridge/x/dist/utils';
import { logger } from '@force-bridge/x/dist/utils/logger';
import { Script } from '@lay2/pw-core';
import CKB from '@nervosnetwork/ckb-sdk-core';
import { AddressPrefix, privateKeyToAddress } from '@nervosnetwork/ckb-sdk-utils';
import { ethers } from 'ethers';
import { JSONRPCClient } from 'json-rpc-2.0';
import fetch from 'node-fetch/index';

export async function generateLockTx(
  client: JSONRPCClient,
  ckbPrivateKey: string,
  sender: string,
  recipient: string,
  assetIdent: string,
  amount: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const lockPayload = {
    assetIdent,
    amount,
    xchain: 'Ethereum',
    recipient,
    sender,
  };

  for (let i = 0; i < 5; i++) {
    try {
      const lockSkeleton = await client.request('generateBridgeNervosToXchainLockTx', lockPayload);
      logger.info('lockSkeleton', lockSkeleton);

      const rawTransaction = objectToTransactionSkeleton(lockSkeleton.rawTransaction);

      const message = lockSkeleton.rawTransaction.signingEntries[0].message;
      logger.info('message', message);
      const signature = key.signRecoverable(message, ckbPrivateKey);

      const signedTx = sealTransaction(rawTransaction, [signature]);

      logger.info('signedTx', signedTx);
      return signedTx;
    } catch (e) {
      if (i == 4) {
        throw e;
      }
      logger.error('generateBridgeNervosToXchainLockTx error', e);
    }
  }
}

export async function generateBurnTx(
  client: JSONRPCClient,
  provider: ethers.providers.JsonRpcProvider,
  ethWallet: ethers.Wallet,
  asset: string,
  nonce: number,
  recipient: string,
  amount: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const burnPayload = {
    asset,
    xchain: 'Ethereum',
    recipient,
    sender: ethWallet.address,
    amount,
  };

  logger.info('burnPayload', burnPayload);
  const unsignedBurnTx = await client.request('generateBridgeNervosToXchainBurnTx', burnPayload);
  logger.info('unsignedBurnTx', unsignedBurnTx);

  const unsignedTx = unsignedBurnTx.rawTransaction;
  unsignedTx.value = unsignedTx.value ? ethers.BigNumber.from(unsignedTx.value.hex) : ethers.BigNumber.from(0);
  unsignedTx.nonce = nonce;
  unsignedTx.gasLimit = ethers.BigNumber.from(2000000);
  unsignedTx.gasPrice = await provider.getGasPrice();

  logger.info('unsignedTx', unsignedTx);

  const signedTx = await ethWallet.signTransaction(unsignedTx);
  logger.info('signedTx', signedTx);

  const hexTx = await Promise.resolve(signedTx).then((t) => ethers.utils.hexlify(t));
  return hexTx;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getTransaction(
  client: JSONRPCClient,
  assetNetwork: 'Ethereum' | 'Nervos',
  assetIdent: string,
  userNetwork: 'Ethereum' | 'Nervos',
  userIdent: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const getTxPayload = {
    network: assetNetwork,
    xchainAssetIdent: assetIdent,
    user: {
      network: userNetwork,
      ident: userIdent,
    },
  };

  const txs = await client.request('getBridgeTransactionSummaries', getTxPayload);

  return txs;
}

async function checkTx(
  client: JSONRPCClient,
  assetNetwork: 'Ethereum' | 'Nervos',
  assetIdent: string,
  userNetwork: 'Ethereum' | 'Nervos',
  userIdent: string,
  txId: string,
) {
  let find = false;
  let pending = false;
  logger.info(
    `check ckb tx start assetNetwork: ${assetNetwork} assetIdent: ${assetIdent} userNetwork: ${userNetwork} userIdent: ${userIdent} txId: ${txId}`,
  );
  for (let i = 0; i < 600; i++) {
    const txs = await getTransaction(client, assetNetwork, assetIdent, userNetwork, userIdent);
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
  logger.info(
    `check eth tx start assetNetwork: ${assetNetwork} assetIdent: ${assetIdent} userNetwork: ${userNetwork} userIdent: ${userIdent} txId: ${txId} pending: ${pending} find: ${find}`,
  );
  if (pending) {
    throw new Error(`rpc test failed, pending for 3000s ${txId}`);
  }
  if (!find) {
    throw new Error(`rpc test failed, can not find record ${txId}`);
  }
}

export async function lock(
  client: JSONRPCClient,
  rpc: RPC,
  ckbPrivateKeys: string[],
  ckbAddresses: string[],
  ethAddresses: string[],
  ckbTokenAddress: string,
  lockAmount: string,
  intervalMs = 50 * 1000,
): Promise<Array<string>> {
  const batchNum = ethAddresses.length;
  const lockTxHashes = new Array<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signedLockTxs = new Array<any>();

  for (let i = 0; i < batchNum; i++) {
    const signedLockTx = await generateLockTx(
      client,
      ckbPrivateKeys[i],
      ckbAddresses[i],
      ethAddresses[i],
      ckbTokenAddress,
      lockAmount,
    );
    signedLockTxs.push(signedLockTx);
  }

  for (let i = 0; i < batchNum; i++) {
    const lockTxHash = await rpc.send_transaction(signedLockTxs[i], 'passthrough');
    await asyncSleep(intervalMs);
    lockTxHashes.push(lockTxHash);
  }
  logger.info('lock txs', lockTxHashes);
  return lockTxHashes;
}

export async function burn(
  client: JSONRPCClient,
  provider: ethers.providers.JsonRpcProvider,
  ethWallets: ethers.Wallet[],
  ckbAddresses: string[],
  xchainTokenAddress: string,
  burnAmount: string,
  intervalMs = 0,
): Promise<Array<string>> {
  const batchNum = ethWallets.length;
  const signedBurnTxs = new Array<string>();
  const burnTxHashes = new Array<string>();

  for (let i = 0; i < batchNum; i++) {
    const startNonce = await provider.getTransactionCount(ethWallets[i].address);
    // const startNonce = await ethWallets[i].getTransactionCount();
    const signedBurnTx = await generateBurnTx(
      client,
      provider,
      ethWallets[i],
      xchainTokenAddress,
      startNonce,
      ckbAddresses[i],
      burnAmount,
    );
    signedBurnTxs.push(signedBurnTx);
  }

  for (let i = 0; i < batchNum; i++) {
    try {
      const tx = await provider.sendTransaction(signedBurnTxs[i]);
      logger.info('burn tx', tx);
      await asyncSleep(intervalMs);
      burnTxHashes.push(tx.hash);
    } catch (e) {
      logger.error(e.stack);
    }
  }
  logger.info('burn txs', burnTxHashes);
  return burnTxHashes;
}

export async function check(
  client: JSONRPCClient,
  batchNum: number,
  assetNetwork: 'Ethereum' | 'Nervos',
  assetIdent: string,
  userNetwork: 'Ethereum' | 'Nervos',
  addresses: Array<string>,
  txHashes: Array<string>,
): Promise<void> {
  for (let i = 0; i < batchNum; i++) {
    await checkTx(client, assetNetwork, assetIdent, userNetwork, addresses[i], txHashes[i]);
  }
}

export function prepareCkbPrivateKeys(batchNum: number): Array<string> {
  const privateKeys = new Array<string>();
  for (let i = 0; i < batchNum; i++) {
    privateKeys.push(ethers.Wallet.createRandom().privateKey);
  }
  return privateKeys;
}

export async function prepareEthWallets(
  provider: ethers.providers.JsonRpcProvider,
  ethPrivateKey: string,
  batchNum: number,
  value: string,
): Promise<Array<ethers.Wallet>> {
  const testWallet = new ethers.Wallet(ethPrivateKey, provider);
  let nonce = await testWallet.getTransactionCount();
  const wallets = new Array<ethers.Wallet>();
  const txHashes: string[] = [];
  for (let i = 0; i < batchNum; i++) {
    const wallet = ethers.Wallet.createRandom();

    const gasPrice = await provider.getGasPrice();
    const tx = {
      nonce: nonce++,
      gasLimit: 21000,
      gasPrice,
      to: wallet.address,
      value: ethers.BigNumber.from(value),
      data: '',
    };
    const signTx = await testWallet.signTransaction(tx);
    const resp = await provider.sendTransaction(signTx);
    logger.info(`prepare send eth ${wallet.address} wallet ${value} eth, resp: ${JSON.stringify(resp)}`);
    txHashes.push(resp.hash);
    wallets.push(wallet);
  }
  const statuses = await Promise.all(
    txHashes.map(async (txHash) => {
      for (let i = 0; i < 600; i++) {
        const transactionReceipet = await provider.getTransactionReceipt(txHash);
        if (transactionReceipet != null) {
          return transactionReceipet.status;
        }
        await asyncSleep(3000);
      }
    }),
  );
  if (statuses.some((status) => status !== 1)) {
    throw new Error(`prepare send eth wallet not all success`);
  }
  logger.info(`prepare send eth finish statuses ${statuses}`);
  return wallets;
}

export async function prepareCkbAddresses(
  ckb: CKB,
  ckbIndexer: CkbIndexer,
  roundNumber: number,
  privateKeys: Array<string>,
  ckbPrivateKey: string,
  lockCkbAmount: string,
  sudtTypescript: ConfigItem,
  sudtArgs: string,
  lockErc20Amount: string,
): Promise<Array<string>> {
  const batchNum = ckbPrivateKey.length;
  const { secp256k1Dep } = await ckb.loadDeps();
  asserts(secp256k1Dep);
  const cellDeps = [
    {
      outPoint: secp256k1Dep.outPoint,
      depType: secp256k1Dep.depType,
    },
    {
      outPoint: sudtTypescript.cellDep.outPoint,
      depType: 'code' as CKBComponents.DepType,
    },
  ];

  const publicKey = ckb.utils.privateKeyToPublicKey(ckbPrivateKey);
  const args = `0x${ckb.utils.blake160(publicKey, 'hex')}`;
  const fromLockscript = {
    code_hash: secp256k1Dep.codeHash,
    args,
    hash_type: secp256k1Dep.hashType,
  };
  asserts(fromLockscript);
  const collector = new IndexerCollector(ckbIndexer);
  const outputs = new Array<CKBComponents.CellOutput>();
  const outputsData = new Array<string>();
  const addresses = new Array<string>();

  const typescript = {
    code_hash: sudtTypescript.script.codeHash,
    hash_type: sudtTypescript.script.hashType,
    args: sudtArgs,
  };

  // collect sudt
  const searchKey = {
    script: fromLockscript,
    script_type: ScriptType.lock,
    filter: {
      script: typescript,
    },
  };
  const perAmount = BigInt(roundNumber * 4) * BigInt(lockErc20Amount);
  const needSudtAmount = BigInt(batchNum) * perAmount;

  await ckbIndexer.waitForSync();
  const sudtCells = await collector.collectSudtByAmount(searchKey, needSudtAmount);
  const totalSudtCap = sudtCells.map((cell) => BigInt(cell.cell_output.capacity)).reduce((a, b) => a + b, 0n);
  const totalSudtAmount = sudtCells.map((cell) => utils.readBigUInt128LE(cell.data)).reduce((a, b) => a + b, 0n);
  if (totalSudtAmount < needSudtAmount) {
    throw new Error('sudt amount is not enough!');
  }
  logger.debug('lock sudtCells: ', sudtCells);

  const sudtInputs = sudtCells.map((cell) => {
    return { previousOutput: { txHash: cell.out_point!.tx_hash, index: cell.out_point!.index }, since: '0x0' };
  });

  let allSudtOutputCap = BigInt(0n);
  for (const privateKey of privateKeys) {
    const toPublicKey = ckb.utils.privateKeyToPublicKey(privateKey);

    const toArgs = `0x${ckb.utils.blake160(toPublicKey, 'hex')}`;
    const toLockscript = {
      code_hash: secp256k1Dep.codeHash,
      args: toArgs,
      hash_type: secp256k1Dep.hashType,
    };
    const outputSudtCell: Cell = {
      cell_output: {
        capacity: '0x0',
        lock: toLockscript,
        type: typescript,
      },
      data: utils.toBigUInt128LE(perAmount),
    };
    const toScript = Script.fromRPC(toLockscript);
    const outputCap = minimalCellCapacity(outputSudtCell);
    allSudtOutputCap += outputCap;
    outputs.push({
      capacity: `0x${outputCap.toString(16)}`,
      lock: toScript!,
      type: Script.fromRPC(typescript)!,
    });
    outputsData.push(outputSudtCell.data);
  }
  const perCapacity = BigInt(roundNumber * 4) * BigInt(lockCkbAmount) + BigInt(100000000000);
  const needSupplyCap = BigInt(batchNum) * perCapacity + allSudtOutputCap - totalSudtCap + BigInt(100000);

  await ckbIndexer.waitForSync();
  const needSupplyCapCells = await collector.getCellsByLockscriptAndCapacity(fromLockscript, needSupplyCap);
  const inputs = sudtInputs.concat(
    needSupplyCapCells.map((cell) => {
      return { previousOutput: { txHash: cell.out_point!.tx_hash, index: cell.out_point!.index }, since: '0x0' };
    }),
  );

  for (const privateKey of privateKeys) {
    const toPublicKey = ckb.utils.privateKeyToPublicKey(privateKey);
    addresses.push(ckb.utils.pubkeyToAddress(toPublicKey, { prefix: AddressPrefix.Testnet }));

    const toArgs = `0x${ckb.utils.blake160(toPublicKey, 'hex')}`;
    const toScript = Script.fromRPC({
      code_hash: secp256k1Dep.codeHash,
      args: toArgs,
      hash_type: secp256k1Dep.hashType,
    });
    const toScriptCell = {
      lock: toScript!,
      capacity: `0x${perCapacity.toString(16)}`,
    };
    outputs.push(toScriptCell);
    outputsData.push('0x');
  }

  const inputCap = needSupplyCapCells.map((cell) => BigInt(cell.cell_output.capacity)).reduce((a, b) => a + b, 0n);
  const outputCap = outputs.map((cell) => BigInt(cell.capacity)).reduce((a, b) => a + b);
  const changeCellCapacity = inputCap - outputCap - allSudtOutputCap - 10000000n;
  outputs.push({
    lock: Script.fromRPC(fromLockscript)!,
    capacity: `0x${changeCellCapacity.toString(16)}`,
  });
  outputsData.push('0x');

  const changeSudtCell: Cell = {
    cell_output: {
      capacity: '0x0',
      lock: fromLockscript,
      type: typescript,
    },
    data: utils.toBigUInt128LE(totalSudtAmount - needSudtAmount),
  };
  const fromScript = Script.fromRPC(fromLockscript);
  const changeSudtCap = minimalCellCapacity(changeSudtCell);

  outputs.push({
    capacity: `0x${changeSudtCap.toString(16)}`,
    lock: fromScript!,
    type: Script.fromRPC(typescript)!,
  });
  outputsData.push(changeSudtCell.data);

  const rawTx = {
    version: '0x0',
    cellDeps,
    headerDeps: [],
    inputs,
    outputs,
    witnesses: [{ lock: '', inputType: '', outputType: '' }],
    outputsData,
  };

  logger.info(`rawTx: ${JSON.stringify(rawTx, null, 2)}`);
  const signedTx = ckb.signTransaction(ckbPrivateKey)(rawTx);
  logger.info('signedTx', signedTx);

  const txHash = await ckb.rpc.sendTransaction(signedTx, 'passthrough');
  logger.info('txHash', txHash);
  for (let i = 0; i < 600; i++) {
    const tx = await ckb.rpc.getTransaction(txHash);
    logger.info('tx', tx);
    if (tx.txStatus.status === 'committed') {
      break;
    }
    await asyncSleep(6000);
  }
  return addresses;
}

// const batchNum = 100;
// const lockAmount = '2000000000000000';
// const burnAmount = '1000000000000000';
// const ethTokenAddress = '0x0000000000000000000000000000000000000000';
//
// const forceBridgeUrl = process.env.FORCE_BRIDGE_RPC_URL || 'http://127.0.0.1:8080/force-bridge/api/v1';
//
// const ethNodeURL = process.env.ETH_URL || 'http://127.0.0.1:8545';
// const ethPrivatekey = process.env.ethPrivatekeyV_KEY || '0xc4ad657963930fbff2e9de3404b30a4e21432c89952ed430b56bf802945ed37a';
//
// const ckbNodeUrl = process.env.CKB_URL || 'http://127.0.0.1:8114';
// const ckbIndexerUrl = process.env.ckbIndexerUrl || 'http://127.0.0.1:8116';
// const ckbPrivateKey = process.env.ckbPrivateKeyV_KEY || '0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe';

// const forceBridgeUrl = 'XXX';

// const ethNodeURL = 'XXX';
// const ethPrivatekey = 'XXX';

// const ckbNodeUrl = 'https://testnet.ckbapp.dev';
// const ckbIndexerUrl = 'https://testnet.ckbapp.dev/indexer';
// const ckbPrivateKey = 'XXX';

export async function ckbBatchTest(
  ethPrivateKey: string,
  ckbPrivateKey: string,
  ethNodeUrl: string,
  ckbNodeUrl: string,
  ckbIndexerUrl: string,
  forceBridgeUrl: string,
  batchNum = 100,
  nervosAssetWhiteList: WhiteListNervosAsset[],
  ckbTypescriptHash = CKB_TYPESCRIPT_HASH,
  lockAmount = '2000000000000000',
  burnAmount = '100000000000000',
): Promise<void> {
  logger.info('ckbBatchTest start!');
  const rpc = new RPC(ckbNodeUrl);

  const client = new JSONRPCClient((jsonRPCRequest) =>
    fetch(forceBridgeUrl, {
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

  const assetInfo = nervosAssetWhiteList.find((asset) => asset.typescriptHash === CKB_TYPESCRIPT_HASH);
  if (!assetInfo) {
    logger.error(`unknown nervosAsset not in WhiteList ${ckbTypescriptHash}, ${nervosAssetWhiteList}`);
  }
  const xchainTokenAddress = assetInfo!.xchainTokenAddress;
  const provider = new ethers.providers.JsonRpcProvider(ethNodeUrl);

  // ckbPrivateKey
  const ckbAddress = privateKeyToAddress(ckbPrivateKey, { prefix: AddressPrefix.Testnet });
  // const value = ethers.utils.parseUnits('10000000000', 18);
  const ethWallets = await prepareEthWallets(provider, ethPrivateKey, batchNum, '10000000000000000');
  // const theWallet = new ethers.Wallet(ethPrivateKey, provider);
  // const ethWallets = [theWallet];
  const ethAddresses = ethWallets.map((ethWallet) => ethWallet.address);

  const lockTxs: string[] = [];
  for (const ethAddress of ethAddresses) {
    const [lockTx] = await lock(
      client,
      rpc,
      [ckbPrivateKey],
      [ckbAddress],
      [ethAddress],
      ckbTypescriptHash,
      lockAmount,
    );
    lockTxs.push(lockTx);
  }
  logger.info('====================================================================');
  logger.info(
    `batchNum: ${batchNum}, ckbTypescriptHash: ${ckbTypescriptHash}, ethAddresses: ${JSON.stringify(
      ethAddresses,
    )}, lockTxs: ${JSON.stringify(lockTxs)}`,
  );
  /*
  batchNum: 1, ckbTypescriptHash: 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff, ethAddresses: ["0xA16495b1d03e40D8969ecCeE863Cedbeaa6E2878"], lockTxs: ["0xe20a14c1de824f50c50843011c14b688aa837f57be31b96b44e363b4204921a9"]
   */
  logger.info('====================================================================');
  await check(client, batchNum, 'Nervos', ckbTypescriptHash, 'Ethereum', ethAddresses, lockTxs);
  const burnTxs: string[] = [];
  for (const ethWallet of ethWallets) {
    const [burnTx] = await burn(client, provider, [ethWallet], [ckbAddress], xchainTokenAddress, burnAmount);
    burnTxs.push(burnTx);
  }
  logger.info(`burnTxs: ${burnTxs}`);
  await check(client, batchNum, 'Nervos', ckbTypescriptHash, 'Ethereum', ethAddresses, burnTxs);
  logger.info('ckbBatchTest pass!');
}
