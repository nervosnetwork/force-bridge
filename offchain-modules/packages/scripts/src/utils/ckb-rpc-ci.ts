import assert from 'assert';
import { key } from '@ckb-lumos/hd';
import { objectToTransactionSkeleton, sealTransaction } from '@ckb-lumos/helpers';
import { RPC } from '@ckb-lumos/rpc';
import { CKB_TYPESCRIPT_HASH } from '@force-bridge/x/dist/config';
import { asyncSleep, privateKeyToCkbAddress, privateKeyToEthAddress } from '@force-bridge/x/dist/utils';
import { logger } from '@force-bridge/x/dist/utils/logger';
import { Amount } from '@lay2/pw-core';
import { ethers } from 'ethers';
import { JSONRPCClient } from 'json-rpc-2.0';
import fetch from 'node-fetch/index';

function generateCases(
  CKB_TEST_ADDRESS: string,
  ETH_TEST_ADDRESS: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ETH_TOKEN_ADDRESS: string,
  CKB_TOKEN_ADDRESS: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  bridgeEthAddress: string,
) {
  const minimalBridgeAmount = 100000000;
  const lockCases = [
    {
      description: 'lock CKB should be successful when amount greater than minimalBridgeAmount',
      payload: {
        sender: CKB_TEST_ADDRESS,
        recipient: ETH_TEST_ADDRESS,
        xchain: 'Ethereum',
        assetIdent: CKB_TOKEN_ADDRESS,
        amount: (minimalBridgeAmount + 1).toString(),
      },
      send: true,
    },
    {
      description: 'lock CKB should be successful when amount equals to minimalBridgeAmount',
      payload: {
        sender: CKB_TEST_ADDRESS,
        recipient: ETH_TEST_ADDRESS,
        xchain: 'Ethereum',
        assetIdent: CKB_TOKEN_ADDRESS,
        amount: minimalBridgeAmount.toString(),
      },
      error: 'Error: lock amount should be greater than minimal bridge amount 100000000',
    },
    {
      description: 'lock CKB should return error when amount less than minimalBridgeAmount',
      payload: {
        sender: CKB_TEST_ADDRESS,
        recipient: ETH_TEST_ADDRESS,
        xchain: 'Ethereum',
        assetIdent: CKB_TOKEN_ADDRESS,
        amount: (minimalBridgeAmount - 1).toString(),
      },
      error: 'Error: lock amount should be greater than minimal bridge amount 100000000',
    },
    {
      description: 'lock CKB should return error when miss sender',
      payload: {
        recipient: ETH_TEST_ADDRESS,
        xchain: 'Ethereum',
        assetIdent: CKB_TOKEN_ADDRESS,
        amount: (minimalBridgeAmount + 1).toString(),
      },
      error: 'Error: invalid ckb address',
    },
    {
      description: 'lock CKB should return error when miss recipient',
      payload: {
        sender: CKB_TEST_ADDRESS,
        xchain: 'Ethereum',
        assetIdent: CKB_TOKEN_ADDRESS,
        amount: (minimalBridgeAmount + 1).toString(),
      },
      error: 'Error: invalid eth address',
    },
    {
      description: 'lock CKB should return error when miss asset.network',
      payload: {
        sender: CKB_TEST_ADDRESS,
        recipient: CKB_TEST_ADDRESS,
        assetIdent: CKB_TOKEN_ADDRESS,
        amount: (minimalBridgeAmount + 1).toString(),
      },
      error: 'Error: unimplement chain type',
    },
    {
      description: 'lock CKB should return error when miss assetIdent',
      payload: {
        sender: CKB_TEST_ADDRESS,
        recipient: ETH_TEST_ADDRESS,
        xchain: 'Ethereum',
        amount: (minimalBridgeAmount + 1).toString(),
      },
      error: `Error: lock asset not in white list`,
    },
    {
      description: 'lock CKB should return error when miss amount',
      payload: {
        sender: CKB_TEST_ADDRESS,
        recipient: ETH_TEST_ADDRESS,
        xchain: 'Ethereum',
        assetIdent: CKB_TOKEN_ADDRESS,
      },
      error: 'Error: Cannot convert undefined to a BigInt',
    },
    {
      description: 'lock CKB should return error when recipient is random string',
      payload: {
        sender: CKB_TEST_ADDRESS,
        recipient: (() => {
          let outString = '';
          const inOptions = 'abcdefghijklmnopqrstuvwxyz0123456789';

          for (let i = 0; i < 10; i++) {
            outString += inOptions.charAt(Math.floor(Math.random() * inOptions.length));
          }

          return outString;
        })(),
        xchain: 'Ethereum',
        assetIdent: CKB_TOKEN_ADDRESS,
      },
      error: `Error: invalid eth address`,
    },
    {
      description: 'lock CKB should return error when recipient length is not correct',
      payload: {
        sender: CKB_TEST_ADDRESS,
        recipient: ETH_TEST_ADDRESS + '0',
        assetIdent: CKB_TOKEN_ADDRESS,
        xchain: 'Ethereum',
        amount: (minimalBridgeAmount + 1).toString(),
      },
      error: 'Error: invalid eth address',
    },
    {
      description: 'lock CKB should return error when xchain is not correct',
      payload: {
        sender: CKB_TEST_ADDRESS,
        recipient: ETH_TEST_ADDRESS + '0',
        assetIdent: CKB_TOKEN_ADDRESS,
        amount: (minimalBridgeAmount + 1).toString(),
      },
      error: 'Error: unimplement chain type',
    },
    {
      description: 'lock CKB should return error when assetIdent length is not correct',
      payload: {
        sender: CKB_TEST_ADDRESS,
        recipient: ETH_TEST_ADDRESS,
        assetIdent: CKB_TOKEN_ADDRESS + '0',
        xchain: 'Ethereum',
        amount: (minimalBridgeAmount + 1).toString(),
      },
      error: 'Error: lock asset not in white list',
    },
    {
      description: 'lock CKB should return error when amount not number',
      payload: {
        sender: CKB_TEST_ADDRESS,
        recipient: ETH_TEST_ADDRESS,
        assetIdent: CKB_TOKEN_ADDRESS,
        xchain: 'Ethereum',
        amount: 'abc',
      },
      error: 'Error: Cannot convert abc to a BigInt',
    },
  ];

  const burnCases = [];

  const txSummaryCases = [];

  const balanceCases = [];

  const feeCases = [];
  return {
    lockCases,
    burnCases,
    txSummaryCases,
    balanceCases,
    feeCases,
  };
}

async function lock(
  rpc: RPC,
  client: JSONRPCClient,
  ETH_NODE_URL: string,
  CKB_PRI_KEY: string,
  CKB_TEST_ADDRESS: string,
  ETH_TEST_ADDRESS: string,
  testcases,
) {
  const casesLength = testcases.length;
  for (let i = 0; i < casesLength; i++) {
    const testcase = testcases[i];
    let lockResult;
    try {
      logger.info(`testcase: ${JSON.stringify(testcase, null, 2)}`);
      lockResult = await client.request('generateBridgeNervosToXchainLockTx', testcase.payload);
      logger.info(`lockResult: ${JSON.stringify(lockResult, null, 2)}`);
    } catch (e) {
      if (testcase.error) {
        logger.info(`error for testcase ${i}: ${testcase.description}, error: ${e}, expected: ${testcase.error}`);
        assert(e.toString() == testcase.error);
        continue;
      }
      if (testcase.error == undefined) {
        throw new Error(`should catch error for testcase ${i}: ${testcase.description}, error: ${e}`);
      }
    }
    if (testcase.error) {
      logger.error(`should not catch error for testcase ${i}: ${testcase.description}`);
      process.exit(1);
    }
    if (testcase.send) {
      const rawTransaction = objectToTransactionSkeleton(lockResult.rawTransaction);
      const message = lockResult.rawTransaction.signingEntries[0].message;
      logger.info('message', message);

      const signature = key.signRecoverable(message, CKB_PRI_KEY);
      const signedTx = sealTransaction(rawTransaction, [signature]);

      logger.info('signedTx', signedTx);

      const lockTxHash = await rpc.send_transaction(signedTx, 'passthrough');
      logger.info('lockTxHash', lockTxHash);

      const assets = await client.request('getAssetList', {});
      const shadowAsset = assets.find((asset) => asset.ident === testcase.payload.assetIdent);
      const xchainAssetIdent = shadowAsset.info.shadow.ident;
      const beforeBalance = await getBalance(
        client,
        testcase.payload.assetIdent,
        xchainAssetIdent,
        CKB_TEST_ADDRESS,
        ETH_TEST_ADDRESS,
      );
      // const { lockFee } = await getFee(client, 'Ethereum', testcase.payload.assetIdent, testcase.payload.amount);

      await checkTx(client, testcase.payload.assetIdent, lockTxHash, CKB_TEST_ADDRESS, ETH_TEST_ADDRESS);

      for (let j = 0; j < 3; j++) {
        const afterBalance = await getBalance(
          client,
          testcase.payload.assetIdent,
          xchainAssetIdent,
          CKB_TEST_ADDRESS,
          ETH_TEST_ADDRESS,
        );

        const beforeSUDTBalance = new Amount(beforeBalance[1].amount, 0);
        const expectedSUDTBalance = beforeSUDTBalance.add(new Amount(testcase.payload.amount, 0));
        const afterSUDTBalance = new Amount(afterBalance[1].amount, 0);
        logger.info(
          `amount before: ${beforeSUDTBalance}, after: ${afterSUDTBalance}, expected: ${expectedSUDTBalance}`,
        );
        if (expectedSUDTBalance.toString() != afterSUDTBalance.toString() && j < 2) {
          await asyncSleep(3000);
          continue;
        }
        assert(expectedSUDTBalance.toString() === afterSUDTBalance.toString());
      }
    }
  }
}

async function burn(
  client: JSONRPCClient,
  ETH_NODE_URL: string,
  ETH_PRI_KEY: string,
  CKB_TEST_ADDRESS: string,
  ETH_TEST_ADDRESS: string,
  testcases,
) {
  const provider = new ethers.providers.JsonRpcProvider(ETH_NODE_URL);
  const wallet = new ethers.Wallet(ETH_PRI_KEY, provider);
  const gasPrice = await provider.getGasPrice();
  let nonce = await wallet.getTransactionCount();

  const casesLength = testcases.length;
  for (let i = 0; i < casesLength; i++) {
    const testcase = testcases[i];
    let lockResult;
    try {
      lockResult = await client.request('generateBridgeNervosToXchainBurnTx', testcase.payload);
    } catch (e) {
      if (testcase.error) {
        logger.info(`error for testcase ${i}: ${testcase.description}, error: ${e}, expected: ${testcase.error}`);
        assert(e.toString() == testcase.error);
        continue;
      }
      if (testcase.error == undefined) {
        throw new Error(`should catch error for testcase ${i}: ${testcase.description}, error: ${e}`);
      }
    }
    if (testcase.error) {
      logger.error(`should not catch error for testcase ${i}: ${testcase.description}`);
      process.exit(1);
    }
    if (testcase.send) {
      const unsignedTx = lockResult.rawTransaction;
      unsignedTx.value = unsignedTx.value ? ethers.BigNumber.from(unsignedTx.value.hex) : ethers.BigNumber.from(0);
      unsignedTx.nonce = nonce;
      unsignedTx.gasLimit = ethers.BigNumber.from(1000000);
      unsignedTx.gasPrice = gasPrice;
      nonce++;

      const assets = await client.request('getAssetList', {});
      const shadowAsset = assets.find((asset) => asset.ident === testcase.payload.assetIdent);
      const xchainAssetIdent = shadowAsset.info.shadow.ident;
      const beforeBalance = await getBalance(
        client,
        testcase.payload.asset.ident,
        xchainAssetIdent,
        CKB_TEST_ADDRESS,
        ETH_TEST_ADDRESS,
      );

      const signedTx = await wallet.signTransaction(unsignedTx);
      const lockTxHash = (await provider.sendTransaction(signedTx)).hash;
      logger.info('lockTxHash', lockTxHash);

      await checkTx(client, testcase.payload.asset.ident, lockTxHash, CKB_TEST_ADDRESS, ETH_TEST_ADDRESS);

      for (let j = 0; j < 3; j++) {
        const afterBalance = await getBalance(
          client,
          testcase.payload.asset.ident,
          xchainAssetIdent,
          CKB_TEST_ADDRESS,
          ETH_TEST_ADDRESS,
        );

        const beforeSUDTBalance = new Amount(beforeBalance[0].amount, 0);
        const expectedSUDTBalance = beforeSUDTBalance.add(new Amount(testcase.payload.asset.amount, 0));
        const afterSUDTBalance = new Amount(afterBalance[0].amount, 0);
        logger.info('amount ', beforeSUDTBalance, afterSUDTBalance, expectedSUDTBalance);
        if (expectedSUDTBalance.toString() != afterSUDTBalance.toString() && j < 2) {
          await asyncSleep(3000);
          continue;
        }
        assert(expectedSUDTBalance.toString() === afterSUDTBalance.toString());
      }
    }
  }
}

async function txSummaries(client: JSONRPCClient, testcases) {
  const casesLength = testcases.length;
  for (let i = 0; i < casesLength; i++) {
    const testcase = testcases[i];
    let txSummariesResult;
    try {
      txSummariesResult = await client.request('getBridgeTransactionSummaries', testcase.payload);
    } catch (e) {
      if (testcase.error) {
        logger.info(`error for testcase ${i} ${testcase.description}, error: ${e}`);
        assert(e.toString() == testcase.error);
        continue;
      }
      if (testcase.error == undefined) {
        throw new Error(`should catch error for testcase ${i} ${testcase.description}, error: ${e}`);
      }
    }
    if (testcase.error) {
      logger.error(`should not catch error for testcase ${i}: ${testcase.description}`);
      process.exit(1);
    }
    if (testcase.result) {
      assert(txSummariesResult.length == 0);
    }
  }
}

async function balance(client: JSONRPCClient, testcases) {
  const casesLength = testcases.length;
  for (let i = 0; i < casesLength; i++) {
    const testcase = testcases[i];
    let balanceResult;
    try {
      balanceResult = await client.request('getBalance', testcase.payload);
    } catch (e) {
      if (testcase.error) {
        logger.info(`error for testcase ${i} ${testcase.description}, error: ${e}`);
        assert(e.toString() == testcase.error);
        continue;
      }
      if (testcase.error == undefined) {
        throw new Error(`should catch error for testcase ${i} ${testcase.description}, error: ${e}`);
      }
    }
    if (testcase.error) {
      logger.error(`should not catch error for testcase ${i}: ${testcase.description}`);
      process.exit(1);
    }
    if (testcase.result) {
      assert(balanceResult == testcase.result);
    }
  }
}

async function getTransaction(client: JSONRPCClient, token_address, userNetwork, address) {
  const getTxPayload = {
    network: 'Nervos',
    xchainAssetIdent: token_address,
    user: {
      network: userNetwork,
      ident: address,
    },
  };

  const txs = await client.request('getBridgeTransactionSummaries', getTxPayload);

  return txs;
}

async function getBalance(
  client: JSONRPCClient,
  assetIdent = CKB_TYPESCRIPT_HASH,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  xchainAssetIdent = CKB_TYPESCRIPT_HASH,
  ckbAddress,
  ethAddress,
) {
  const assets = await client.request('getAssetList', {});

  const shadowAsset = assets.find((asset) => asset.ident === assetIdent);

  const ckbBalancePayload = {
    network: 'Nervos',
    userIdent: ckbAddress,
    assetIdent,
  };
  const ethBalancePayload = {
    network: 'Ethereum',
    userIdent: ethAddress,
    assetIdent: shadowAsset.info.shadow.ident,
  };
  logger.info('balance', ckbBalancePayload, ethBalancePayload);
  const balance = await client.request('getBalance', [ckbBalancePayload, ethBalancePayload]);
  logger.info('balance', balance);
  return balance;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getFee(client: JSONRPCClient, xchain, typescriptHash, amount) {
  const payload = {
    xchain,
    typescriptHash,
    amount,
  };
  const lockFee = await client.request('getBridgeNervosToXchainLockBridgeFee', payload);
  const burnFee = await client.request('getBridgeNervosToXchainBurnBridgeFee', payload);
  logger.info('lockFee, burnFee', lockFee, burnFee);
  return { lockFee, burnFee };
}

async function checkTx(client: JSONRPCClient, token_address, txId, ckbAddress, ethAddress) {
  let find = false;
  let pending = false;
  for (let i = 0; i < 2000; i++) {
    const txs = await getTransaction(client, token_address, 'Nervos', ckbAddress);
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

  find = false;
  pending = false;
  const txs = await getTransaction(client, token_address, 'Ethereum', ethAddress);
  for (const tx of txs) {
    if (tx.status == 'Successful' && tx.txSummary.fromTransaction.txId == txId) {
      logger.info('tx', tx);
      find = true;
      pending = false;
      break;
    }
  }
  if (pending) {
    throw new Error(`rpc test failed, still pending ${txId}`);
  }
  if (!find) {
    throw new Error(`rpc test failed, can not find record ${txId}`);
  }
}

// const FORCE_BRIDGE_URL = 'http://127.0.0.1:8080/force-bridge/api/v1';
// const ETH_NODE_URL = 'http://127.0.0.1:8545';
//
// const ETH_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000';
// // const ERC20_DAI_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000';
// // const ERC20_USDT_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000';
// // const ERC20_USDC_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000';
//
// const ETH_PRI_KEY = '0xc4ad657963930fbff2e9de3404b30a4e21432c89952ed430b56bf802945ed37a';
// const ETH_TEST_ADDRESS = '0x17c4b5CE0605F63732bfd175feCe7aC6b4620FD2';
//
// const CKB_NODE_URL = 'http://127.0.0.1:8114';
// // const CKB_INDEXER_URL = 'http://127.0.0.1:8116';
//
// const CKB_PRI_KEY = '0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe';
// const CKB_TEST_ADDRESS = 'ckt1qyqyph8v9mclls35p6snlaxajeca97tc062sa5gahk';

// const FORCE_BRIDGE_URL = 'http://47.56.233.149:3083/force-bridge/api/v1';
// const ETH_NODE_URL = 'https://rinkeby.infura.io/v3/48be8feb3f9c46c397ceae02a0dbc7ae';

// const ETH_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000';
// const ERC20_DAI_TOKEN_ADDRESS = '0x7Af456bf0065aADAB2E6BEc6DaD3731899550b84';
// const ERC20_USDT_TOKEN_ADDRESS = '0x74a3dbd5831f45CD0F3002Bb87a59B7C15b1B5E6';
// const ERC20_USDC_TOKEN_ADDRESS = '0x265566D4365d80152515E800ca39424300374A83';

// const ETH_PRI_KEY = '32b91b335e1141fa8beaaf44ce7a695cc87ae4e9ff2f93c4148f4ce108762926';
// const ETH_TEST_ADDRESS = '0xaC82c91dEF0B524831c2C2c56516Be78eb0F7ACD';

// const CKB_NODE_URL = 'https://testnet.ckbapp.dev';
// const CKB_INDEXER_URL = 'https://testnet.ckbapp.dev/indexer';

// const CKB_PRI_KEY = '0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe';
// const CKB_TEST_ADDRESS = 'ckt1qyqyph8v9mclls35p6snlaxajeca97tc062sa5gahk';

export async function rpcTest(
  FORCE_BRIDGE_URL: string,
  CKB_NODE_URL: string,
  ETH_NODE_URL: string,
  CKB_PRI_KEY: string,
  ETH_PRI_KEY: string,
  bridgeEthAddress: string,
  CKB_TEST_ADDRESS: string = privateKeyToCkbAddress(CKB_PRI_KEY),
  ETH_TEST_ADDRESS: string = privateKeyToEthAddress(ETH_PRI_KEY),
  ETH_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000',
  CKB_TOKEN_ADDRESS = CKB_TYPESCRIPT_HASH,
): Promise<void> {
  const rpc = new RPC(CKB_NODE_URL);

  // JSONRPCClient needs to know how to send a JSON-RPC request.
  // Tell it by passing a function to its constructor. The function must take a JSON-RPC request and send it.
  const client = new JSONRPCClient((jsonRPCRequest) =>
    fetch(FORCE_BRIDGE_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(jsonRPCRequest),
    }).then((response) => {
      if (response.status === 200) {
        // Use client.receive when you received a JSON-RPC response.
        return response.json().then((jsonRPCResponse) => client.receive(jsonRPCResponse));
      } else if (jsonRPCRequest.id !== undefined) {
        return Promise.reject(new Error(response.statusText));
      }
    }),
  );

  const { lockCases, burnCases, txSummaryCases, balanceCases } = generateCases(
    CKB_TEST_ADDRESS,
    ETH_TEST_ADDRESS,
    ETH_TOKEN_ADDRESS,
    CKB_TOKEN_ADDRESS,
    bridgeEthAddress,
  );

  await lock(rpc, client, ETH_NODE_URL, CKB_PRI_KEY, CKB_TEST_ADDRESS, ETH_TEST_ADDRESS, lockCases);
  await burn(client, ETH_NODE_URL, CKB_PRI_KEY, CKB_TEST_ADDRESS, ETH_TEST_ADDRESS, burnCases);
  await txSummaries(client, txSummaryCases);
  await balance(client, balanceCases);
  logger.info('ckb-rpc-ci test pass!');
}
