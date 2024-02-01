import { generateGenesisScriptConfigs } from '@ckb-lumos/config-manager';
import { encodeToAddress, parseAddress, TransactionSkeleton, objectToTransactionSkeleton } from '@ckb-lumos/helpers';
import { hd, Indexer as CkbIndexer, RPC, Script, helpers, Indexer, commons, BI, Transaction } from '@ckb-lumos/lumos';
import { CkbTxHelper } from '@force-bridge/x/dist/ckb/tx-helper/base_generator';
import { IndexerCollector } from '@force-bridge/x/dist/ckb/tx-helper/collector';
import { asserts } from '@force-bridge/x/dist/errors';
import { asyncSleep } from '@force-bridge/x/dist/utils';
import { logger } from '@force-bridge/x/dist/utils/logger';
import { ethers } from 'ethers';
import { JSONRPCClient } from 'json-rpc-2.0';
import fetch from 'node-fetch/index';

export async function generateLockTx(
  client: JSONRPCClient,
  ethWallet: ethers.Wallet,
  assetIdent: string,
  nonce: number,
  recipient: string,
  amount: string,
  ethNodeURL: string,
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
  logger.info('unsignedLockTx', unsignedLockTx);

  const provider = new ethers.providers.JsonRpcProvider(ethNodeURL);

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

export async function generateBurnTx(
  rpc: RPC,
  client: JSONRPCClient,
  asset: string,
  ckbPriv: string,
  sender: string,
  recipient: string,
  amount: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Transaction | undefined> {
  const burnPayload = {
    network: 'Ethereum',
    sender: sender,
    recipient: recipient,
    asset: asset,
    amount: amount,
  };

  for (let i = 0; i < 5; i++) {
    try {
      const res = await client.request('generateBridgeOutNervosTransaction', burnPayload);
      const burnTxSkeleton = commons.common.prepareSigningEntries(objectToTransactionSkeleton(res.rawTransaction));
      const signingEntries = burnTxSkeleton.get('signingEntries');
      const sigs = signingEntries!
        .map((signingEntrie) => hd.key.signRecoverable(signingEntrie.message!, ckbPriv))
        .toArray();
      const signedTx = helpers.sealTransaction(burnTxSkeleton, sigs);

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
async function getTransaction(client: JSONRPCClient, assetIdent: string, userIdent: string): Promise<any> {
  const getTxPayload = {
    network: 'Ethereum',
    xchainAssetIdent: assetIdent,
    user: {
      network: 'Nervos',
      ident: encodeToAddress(parseAddress(userIdent)),
    },
  };

  const txs = await client.request('getBridgeTransactionSummaries', getTxPayload);

  return txs;
}

async function checkTx(client: JSONRPCClient, assetIdent: string, txId: string, userIdent: string) {
  let find = false;
  let pending = false;
  for (let i = 0; i < 600; i++) {
    const txs = await getTransaction(client, assetIdent, userIdent);
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

export async function lock(
  client: JSONRPCClient,
  provider: ethers.providers.JsonRpcProvider,
  ethWallet: ethers.Wallet,
  recipients: Array<string>,
  ethTokenAddress: string,
  lockAmount: string,
  ethNodeURL: string,
  intervalMs = 0,
): Promise<Array<string>> {
  const batchNum = recipients.length;
  const signedLockTxs = new Array<string>();
  const lockTxHashes = new Array<string>();
  const startNonce = await ethWallet.getTransactionCount();

  for (let i = 0; i < batchNum; i++) {
    const signedLockTx = await generateLockTx(
      client,
      ethWallet,
      ethTokenAddress,
      startNonce + i,
      recipients[i],
      lockAmount,
      ethNodeURL,
    );
    signedLockTxs.push(signedLockTx);
  }

  for (let i = 0; i < batchNum; i++) {
    const lockTxHash = (await provider.sendTransaction(signedLockTxs[i])).hash;
    await asyncSleep(intervalMs);
    lockTxHashes.push(lockTxHash);
  }
  logger.info('lock txs', lockTxHashes);
  return lockTxHashes;
}

export async function burn(
  rpc: RPC,
  client: JSONRPCClient,
  ckbPrivs: Array<string>,
  senders: Array<string>,
  recipient: string,
  ethTokenAddress: string,
  burnAmount: string,
  intervalMs = 0,
): Promise<Array<string>> {
  const batchNum = ckbPrivs.length;
  const burnTxHashes = new Array<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signedBurnTxs = new Array<Transaction>();
  for (let i = 0; i < batchNum; i++) {
    const burnTx = await generateBurnTx(rpc, client, ethTokenAddress, ckbPrivs[i], senders[i], recipient, burnAmount);
    signedBurnTxs.push(burnTx!);
  }

  for (let i = 0; i < batchNum; i++) {
    const burnETHTxHash = await rpc.sendTransaction(signedBurnTxs[i], 'passthrough');
    await asyncSleep(intervalMs);
    burnTxHashes.push(burnETHTxHash);
  }
  logger.info('burn txs', burnTxHashes);
  return burnTxHashes;
}

export async function check(
  client: JSONRPCClient,
  txHashes: Array<string>,
  addresses: Array<string>,
  batchNum: number,
  ethTokenAddress: string,
): Promise<void> {
  for (let i = 0; i < batchNum; i++) {
    await checkTx(client, ethTokenAddress, txHashes[i], addresses[i]);
  }
}

export function prepareCkbPrivateKeys(batchNum: number): Array<string> {
  const privateKeys = new Array<string>();
  for (let i = 0; i < batchNum; i++) {
    privateKeys.push(ethers.Wallet.createRandom().privateKey);
  }
  return privateKeys;
}

export async function prepareCkbAddresses(
  rpc: RPC,
  privateKeys: Array<string>,
  ckbPrivateKey: string,
  ckbNodeUrl: string,
  ckbIndexerUrl: string,
): Promise<Array<string>> {
  const ckbTxHelper = new CkbTxHelper(ckbNodeUrl, ckbIndexerUrl);
  let txSkeleton = TransactionSkeleton({ cellProvider: new Indexer(ckbIndexerUrl) });

  const batchNum = ckbPrivateKey.length;
  const { SECP256K1_BLAKE160 } = generateGenesisScriptConfigs(await rpc.getBlockByNumber('0x0'));
  asserts(SECP256K1_BLAKE160);

  const args = hd.key.privateKeyToBlake160(ckbPrivateKey);
  const fromLockscript = {
    codeHash: SECP256K1_BLAKE160.CODE_HASH,
    args,
    hashType: SECP256K1_BLAKE160.HASH_TYPE,
  };
  const fromAddress = helpers.encodeToAddress(fromLockscript);
  asserts(fromLockscript);
  const needSupplyCap = batchNum * 600 * 100000000 + 100000;
  const collector = new IndexerCollector(new CkbIndexer(ckbNodeUrl, ckbIndexerUrl));

  const needSupplyCapCells = await collector.getCellsByLockscriptAndCapacity(fromLockscript, BigInt(needSupplyCap));

  let inputCap = BI.from(0);
  for (const cell of needSupplyCapCells) {
    inputCap = inputCap.add(BI.from(cell.cellOutput.capacity));
    txSkeleton = await commons.common.setupInputCell(txSkeleton, cell);
  }
  const addresses = new Array<string>();
  let outputCap = BI.from(0);
  for (const key of privateKeys) {
    const toScript: Script = {
      codeHash: SECP256K1_BLAKE160.CODE_HASH,
      args: hd.key.privateKeyToBlake160(key),
      hashType: SECP256K1_BLAKE160.HASH_TYPE,
    };
    addresses.push(helpers.encodeToAddress(toScript));
    const capacity = 600 * 100000000;
    outputCap = outputCap.add(capacity);

    const toScriptCell = {
      lock: toScript,
      capacity: `0x${capacity.toString(16)}`,
    };
    txSkeleton = txSkeleton.update('outputs', (outputs) =>
      outputs.push({
        cellOutput: toScriptCell,
        data: '0x',
      }),
    );
  }
  txSkeleton = txSkeleton.update('outputs', (outputs) => {
    const output = outputs.get(0)!;
    output.cellOutput.capacity = `0x${inputCap.sub(outputCap).toString(16)}`;
    return outputs.set(0, output);
  });
  logger.info(`txSkeleton: ${JSON.stringify(txSkeleton, null, 2)}`);

  txSkeleton = await commons.common.payFeeByFeeRate(txSkeleton, [fromAddress], 1000);
  txSkeleton = commons.common.prepareSigningEntries(txSkeleton);
  const message = txSkeleton.get('signingEntries').get(0)?.message;
  const sig = hd.key.signRecoverable(message!, ckbPrivateKey);
  const tx = helpers.sealTransaction(txSkeleton, [sig]);

  logger.info(`rawTx: ${JSON.stringify(tx, null, 2)}`);
  const burnTxHash = await rpc.sendTransaction(tx, 'passthrough');
  await ckbTxHelper.waitUntilCommitted(burnTxHash, 120);
  logger.info('tx', burnTxHash);
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

export async function ethBatchTest(
  ethPrivateKey: string,
  ckbPrivateKey: string,
  ethNodeUrl: string,
  ckbNodeUrl: string,
  ckbIndexerUrl: string,
  forceBridgeUrl: string,
  batchNum = 100,
  ethTokenAddress = '0x0000000000000000000000000000000000000000',
  lockAmount = '2000000000000000',
  burnAmount = '1000000000000000',
): Promise<void> {
  logger.info('ethBatchTest start!');
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

  const provider = new ethers.providers.JsonRpcProvider(ethNodeUrl);
  const ethWallet = new ethers.Wallet(ethPrivateKey, provider);
  const ethAddress = ethWallet.address;

  const ckbPrivs = await prepareCkbPrivateKeys(batchNum);
  const ckbAddresses = await prepareCkbAddresses(rpc, ckbPrivs, ckbPrivateKey, ckbNodeUrl, ckbIndexerUrl);

  const lockTxs = await lock(client, provider, ethWallet, ckbAddresses, ethTokenAddress, lockAmount, ethNodeUrl);
  await check(client, lockTxs, ckbAddresses, batchNum, ethTokenAddress);

  const burnTxs = await burn(rpc, client, ckbPrivs, ckbAddresses, ethAddress, ethTokenAddress, burnAmount);
  await check(client, burnTxs, ckbAddresses, batchNum, ethTokenAddress);
  logger.info('ethBatchTest pass!');
}
