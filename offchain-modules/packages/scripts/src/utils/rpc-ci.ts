import assert from 'assert';
import { asyncSleep, privateKeyToCkbAddress, privateKeyToEthAddress } from '@force-bridge/x/dist/utils';
import { logger } from '@force-bridge/x/dist/utils/logger';
import { Amount } from '@lay2/pw-core';
import CKB from '@nervosnetwork/ckb-sdk-core';
import { ethers } from 'ethers';
import { JSONRPCClient } from 'json-rpc-2.0';
import fetch from 'node-fetch/index';

function generateCases(
  CKB_TEST_ADDRESS: string,
  ETH_TEST_ADDRESS: string,
  ETH_TOKEN_ADDRESS: string,
  bridgeEthAddress: string,
) {
  const lockCases = [
    {
      description: 'lock ETH should be successful when amount greater than minimalBridgeAmount',
      payload: {
        sender: ETH_TEST_ADDRESS,
        recipient: CKB_TEST_ADDRESS,
        asset: {
          network: 'Ethereum',
          ident: ETH_TOKEN_ADDRESS,
          amount: '1000000000000001',
        },
      },
      send: true,
    },
    {
      description: 'lock ETH should be successful when amount equals to minimalBridgeAmount',
      payload: {
        sender: ETH_TEST_ADDRESS,
        recipient: CKB_TEST_ADDRESS,
        asset: {
          network: 'Ethereum',
          ident: ETH_TOKEN_ADDRESS,
          amount: '1000000000000000',
        },
      },
      send: true,
    },
    {
      description: 'lock ETH should return error when amount less than minimalBridgeAmount',
      payload: {
        sender: ETH_TEST_ADDRESS,
        recipient: CKB_TEST_ADDRESS,
        asset: {
          network: 'Ethereum',
          ident: ETH_TOKEN_ADDRESS,
          amount: '9999999999999',
        },
      },
      error: 'Error: minimal bridge amount is 0.00001 ETH',
    },
    // {
    //   description: 'lock DAI should be successful when amount greater than minimalBridgeAmount',
    //   payload: {
    //     sender: ETH_TEST_ADDRESS,
    //     recipient: CKB_TEST_ADDRESS,
    //     asset: {
    //       network: 'Ethereum',
    //       ident: ERC20_DAI_TOKEN_ADDRESS,
    //       amount: '1000000000000001',
    //     },
    //   },
    //   send: true,
    // },
    // {
    //   description: 'lock DAI should be successful when amount equals to minimalBridgeAmount',
    //   payload: {
    //     sender: ETH_TEST_ADDRESS,
    //     recipient: CKB_TEST_ADDRESS,
    //     asset: {
    //       network: 'Ethereum',
    //       ident: ERC20_DAI_TOKEN_ADDRESS,
    //       amount: '1000000000000000',
    //     },
    //   },
    //   send: true,
    // },
    // {
    //   description: 'lock DAI should return error when amount less than minimalBridgeAmount',
    //   payload: {
    //     sender: ETH_TEST_ADDRESS,
    //     recipient: CKB_TEST_ADDRESS,
    //     asset: {
    //       network: 'Ethereum',
    //       ident: ERC20_DAI_TOKEN_ADDRESS,
    //       amount: '999999999999999',
    //     },
    //   },
    //   error: 'Error: minimal bridge amount is 0.001 DAI',
    // },
    {
      description: 'lock ETH should be successful when miss sender',
      payload: {
        recipient: CKB_TEST_ADDRESS,
        asset: {
          network: 'Ethereum',
          ident: ETH_TOKEN_ADDRESS,
          amount: '1000000000000001',
        },
      },
      send: true,
    },
    {
      description: 'lock ETH should return error when miss recipient',
      payload: {
        sender: ETH_TEST_ADDRESS,
        asset: {
          network: 'Ethereum',
          ident: ETH_TOKEN_ADDRESS,
          amount: '1000000000000001',
        },
      },
      error: `Error: invalid ckb address`,
    },
    {
      description: 'lock ETH should return error when miss asset.network',
      payload: {
        sender: ETH_TEST_ADDRESS,
        recipient: CKB_TEST_ADDRESS,
        asset: {
          ident: ETH_TOKEN_ADDRESS,
          amount: '1000000000000001',
        },
      },
      error: `Error: invalid chain type`,
    },
    {
      description: 'lock ETH should return error when miss asset.ident',
      payload: {
        sender: ETH_TEST_ADDRESS,
        recipient: CKB_TEST_ADDRESS,
        asset: {
          network: 'Ethereum',
          amount: '1000000000000001',
        },
      },
      error: `Error: Cannot read property 'startsWith' of undefined`,
    },
    {
      description: 'lock ETH should return error when miss asset.amount',
      payload: {
        sender: ETH_TEST_ADDRESS,
        recipient: CKB_TEST_ADDRESS,
        asset: {
          network: 'Ethereum',
          ident: ETH_TOKEN_ADDRESS,
        },
      },
      error: `Error: Cannot convert undefined to a BigInt`,
    },
    {
      description: 'lock ETH should return error when recipient is random string',
      payload: {
        sender: ETH_TEST_ADDRESS,
        recipient: randomString(46),
        asset: {
          network: 'Ethereum',
          ident: ETH_TOKEN_ADDRESS,
          amount: '1000000000000001',
        },
      },
      error: `Error: invalid ckb address`,
    },
    {
      description: 'lock ETH should return error when recipient length is not correct',
      payload: {
        sender: ETH_TEST_ADDRESS,
        recipient: CKB_TEST_ADDRESS + '0',
        asset: {
          network: 'Ethereum',
          ident: ETH_TOKEN_ADDRESS,
          amount: '1000000000000001',
        },
      },
      error: `Error: invalid ckb address`,
    },
    {
      description: 'lock ETH should return error when asset.network is not correct',
      payload: {
        sender: ETH_TEST_ADDRESS,
        recipient: CKB_TEST_ADDRESS,
        asset: {
          network: 'ETH',
          ident: ETH_TOKEN_ADDRESS,
          amount: '1000000000000001',
        },
      },
      error: `Error: invalid chain type`,
    },
    {
      description: 'lock ETH should return error when asset.ident length is not correct',
      payload: {
        sender: ETH_TEST_ADDRESS,
        recipient: CKB_TEST_ADDRESS,
        asset: {
          network: 'Ethereum',
          ident: ETH_TOKEN_ADDRESS + '0',
          amount: '1000000000000001',
        },
      },
      error: `Error: invalid ETH asset address`,
    },
    {
      description: 'lock ETH should return error when asset.ident without prefix',
      payload: {
        sender: ETH_TEST_ADDRESS,
        recipient: CKB_TEST_ADDRESS,
        asset: {
          network: 'Ethereum',
          ident: '0000000000000000000000000000000000000000',
          amount: '1000000000000001',
        },
      },
      error: `Error: invalid ETH asset address`,
    },
    {
      description: 'lock ETH should return error when asset.ident not exist',
      payload: {
        sender: ETH_TEST_ADDRESS,
        recipient: CKB_TEST_ADDRESS,
        asset: {
          network: 'Ethereum',
          ident: '0x1445ce35416f6d65238d78f4093e051ec6d22ec8',
          amount: '1000000000000001',
        },
      },
      error: `Error: EthAsset 0x1445ce35416f6d65238d78f4093e051ec6d22ec8 not in while list`,
    },
    {
      description: 'lock ETH should return error when recipient is too long',
      payload: {
        sender: ETH_TEST_ADDRESS,
        recipient:
          'ckt1qn3qcg07nlfjc4rwqnu3dntrtrcwd6p48vy72q7rkgkqzvwt5evl5hcqqqqpqqqqqqcqqqqqxyqqqqym2zpn63k5c3jp4cmdze0n5ajgep4ky0g5mjc6fvua3wfekfz2auqj5qqqqqc8sd6pvc6r2dnzvccrqd34v9q5gs2zxfznvsj9vvmygc2yxvmnxvfc8yun2dfsvgurgputy4y',
        asset: {
          network: 'Ethereum',
          ident: ETH_TOKEN_ADDRESS,
          amount: '1000000000000001',
        },
      },
      error: `Error: sudt size exceeds limit: {"sudtSizeLimit":200,"actualSudtSize":217}`,
    },
    {
      description: 'lock ETH should return error when asset.amount not number',
      payload: {
        sender: ETH_TEST_ADDRESS,
        recipient: CKB_TEST_ADDRESS,
        asset: {
          network: 'Ethereum',
          ident: ETH_TOKEN_ADDRESS,
          amount: 'abc',
        },
      },
      error: `Error: Cannot convert abc to a BigInt`,
    },
  ];

  const burnCases = [
    {
      description: 'burn ETH should be successful when amount greater than minimalBridgeAmount',
      payload: {
        network: 'Ethereum',
        sender: CKB_TEST_ADDRESS,
        recipient: ETH_TEST_ADDRESS,
        asset: ETH_TOKEN_ADDRESS,
        amount: '1000000000000001',
      },
      send: true,
    },
    {
      description: 'burn ETH should be successful when amount equals to minimalBridgeAmount',
      payload: {
        network: 'Ethereum',
        sender: CKB_TEST_ADDRESS,
        recipient: ETH_TEST_ADDRESS,
        asset: ETH_TOKEN_ADDRESS,
        amount: '1000000000000000',
      },
      send: true,
    },
    {
      description: 'burn ETH should return error when amount less than minimalBridgeAmount',
      payload: {
        network: 'Ethereum',
        sender: CKB_TEST_ADDRESS,
        recipient: ETH_TEST_ADDRESS,
        asset: ETH_TOKEN_ADDRESS,
        amount: '9999999999999',
      },
      error: 'Error: minimal bridge amount is 0.00001 ETH',
    },
    // {
    //   description: 'burn DAI should be successful when amount greater than minimalBridgeAmount',
    //   payload: {
    //     network: 'Ethereum',
    //     sender: CKB_TEST_ADDRESS,
    //     recipient: ETH_TEST_ADDRESS,
    //     asset: ERC20_DAI_TOKEN_ADDRESS,
    //     amount: '1000000000000001',
    //   },
    //   error: true,
    // },
    // {
    //   description: 'burn DAI should be successful when amount equals to minimalBridgeAmount',
    //   payload: {
    //     network: 'Ethereum',
    //     sender: CKB_TEST_ADDRESS,
    //     recipient: ETH_TEST_ADDRESS,
    //     asset: ERC20_DAI_TOKEN_ADDRESS,
    //     amount: '1000000000000000',
    //   },
    //   send: true,
    // },
    // {
    //   description: 'burn DAI should return error when amount less than minimalBridgeAmount',
    //   payload: {
    //     network: 'Ethereum',
    //     sender: CKB_TEST_ADDRESS,
    //     recipient: ETH_TEST_ADDRESS,
    //     asset: ERC20_DAI_TOKEN_ADDRESS,
    //     amount: '999999999999999',
    //   },
    //   error: 'Error: minimal bridge amount is 0.001 DAI',
    // },
    {
      description: 'burn ETH should return error when miss network',
      payload: {
        sender: CKB_TEST_ADDRESS,
        recipient: ETH_TEST_ADDRESS,
        asset: ETH_TOKEN_ADDRESS,
        amount: '1000000000000000',
      },
      error: 'Error: invalid chain type',
    },
    {
      description: 'burn ETH should return error when miss sender',
      payload: {
        network: 'Ethereum',
        recipient: ETH_TEST_ADDRESS,
        asset: ETH_TOKEN_ADDRESS,
        amount: '1000000000000000',
      },
      error: 'Error: invalid ckb address',
    },
    {
      description: 'burn ETH should return error when recipient is zero address',
      payload: {
        network: 'Ethereum',
        sender: CKB_TEST_ADDRESS,
        recipient: '0x0000000000000000000000000000000000000000',
        asset: ETH_TOKEN_ADDRESS,
        amount: '1000000000000000',
      },
      error: 'Error: can not unlock to zero address',
    },
    {
      description: 'burn ETH should return error when recipient is contract address',
      payload: {
        network: 'Ethereum',
        sender: CKB_TEST_ADDRESS,
        recipient: bridgeEthAddress,
        asset: ETH_TOKEN_ADDRESS,
        amount: '1000000000000000',
      },
      error: 'Error: can not unlock to contract',
    },
    {
      description: 'burn ETH should return error when miss recipient',
      payload: {
        network: 'Ethereum',
        sender: CKB_TEST_ADDRESS,
        asset: ETH_TOKEN_ADDRESS,
        amount: '1000000000000000',
      },
      error: 'Error: invalid eth address',
    },
    {
      description: 'burn ETH should return error when miss asset',
      payload: {
        network: 'Ethereum',
        sender: CKB_TEST_ADDRESS,
        recipient: ETH_TEST_ADDRESS,
        amount: '1000000000000000',
      },
      error: `Error: Cannot read property 'startsWith' of undefined`,
    },
    {
      description: 'burn ETH should return error when miss amount',
      payload: {
        network: 'Ethereum',
        sender: CKB_TEST_ADDRESS,
        recipient: ETH_TEST_ADDRESS,
        asset: ETH_TOKEN_ADDRESS,
      },
      error: 'Error: Cannot convert undefined to a BigInt',
    },
    {
      description: 'burn ETH should return error when network is invalid',
      payload: {
        network: 'Invalid',
        sender: CKB_TEST_ADDRESS,
        recipient: ETH_TEST_ADDRESS,
        asset: ETH_TOKEN_ADDRESS,
        amount: '1000000000000000',
      },
      error: 'Error: invalid chain type',
    },
    {
      description: 'burn ETH should return error when sender is invalid',
      payload: {
        network: 'Ethereum',
        sender: randomString(46),
        recipient: ETH_TEST_ADDRESS,
        asset: ETH_TOKEN_ADDRESS,
        amount: '1000000000000000',
      },
      error: 'Error: invalid ckb address',
    },
    {
      description: 'burn ETH should return error when recipient is not hex',
      payload: {
        network: 'Ethereum',
        sender: CKB_TEST_ADDRESS,
        recipient: randomString(40, '0x'),
        asset: ETH_TOKEN_ADDRESS,
        amount: '1000000000000000',
      },
      error: 'Error: invalid eth address',
    },
    {
      description: 'burn ETH should return error when recipient length not correct',
      payload: {
        network: 'Ethereum',
        sender: CKB_TEST_ADDRESS,
        recipient: randomString(42, '0x', 'hex'),
        asset: ETH_TOKEN_ADDRESS,
        amount: '1000000000000000',
      },
      error: 'Error: invalid eth address',
    },
    {
      description: 'burn ETH should return error when recipient without prefix',
      payload: {
        network: 'Ethereum',
        sender: CKB_TEST_ADDRESS,
        recipient: ETH_TEST_ADDRESS.substr(2, 40),
        asset: ETH_TOKEN_ADDRESS,
        amount: '1000000000000000',
      },
      error: 'Error: invalid eth address',
    },
    {
      description: 'burn ETH should return error when asset not on whitelist',
      payload: {
        network: 'Ethereum',
        sender: CKB_TEST_ADDRESS,
        recipient: ETH_TEST_ADDRESS,
        asset: randomString(40, '0x', 'hex'),
        amount: '1000000000000000',
      },
      error: 'Error: minimal amount not configed',
    },
    {
      description: 'burn ETH should return error when asset without prefix',
      payload: {
        network: 'Ethereum',
        sender: CKB_TEST_ADDRESS,
        recipient: ETH_TEST_ADDRESS,
        asset: '0000000000000000000000000000000000000000',
        amount: '1000000000000000',
      },
      error: 'Error: invalid ETH asset address',
    },
    {
      description: 'burn ETH should return error when amount is not number',
      payload: {
        network: 'Ethereum',
        sender: CKB_TEST_ADDRESS,
        recipient: ETH_TEST_ADDRESS,
        asset: ETH_TOKEN_ADDRESS,
        amount: 'abc',
      },
      error: 'Error: Cannot convert abc to a BigInt',
    },
    {
      description: 'burn ETH should return error when amount over balance',
      payload: {
        network: 'Ethereum',
        sender: CKB_TEST_ADDRESS,
        recipient: ETH_TEST_ADDRESS,
        asset: ETH_TOKEN_ADDRESS,
        amount: '10000000000000000000',
      },
      error: 'Error: sudt amount is not enough!',
    },
  ];

  const txSummaryCases = [
    {
      description: 'get tx summaries should return error when miss network',
      payload: {
        xchainAssetIdent: ETH_TOKEN_ADDRESS,
        user: {
          network: 'Ethereum',
          ident: ETH_TEST_ADDRESS,
        },
      },
      error: 'Error: invalid bridge chain type',
    },
    {
      description: 'get tx summaries should return null when miss xchainAssetIdent',
      payload: {
        network: 'Ethereum',
        user: {
          network: 'Ethereum',
          ident: ETH_TEST_ADDRESS,
        },
      },
      result: [],
    },
    {
      description: 'get tx summaries should return error when miss user.network',
      payload: {
        network: 'Ethereum',
        xchainAssetIdent: ETH_TOKEN_ADDRESS,
        user: {
          ident: ETH_TEST_ADDRESS,
        },
      },
      error: 'Error: invalid address chain type',
    },
    {
      description: 'get tx summaries should return null when miss user.ident',
      payload: {
        network: 'Ethereum',
        xchainAssetIdent: ETH_TOKEN_ADDRESS,
        user: {
          network: 'Ethereum',
        },
      },
      result: [],
    },
    {
      description: 'get tx summaries should return error when network is invalid',
      payload: {
        network: 'Invalid',
        xchainAssetIdent: ETH_TOKEN_ADDRESS,
        user: {
          network: 'Ethereum',
          ident: ETH_TEST_ADDRESS,
        },
      },
      error: 'Error: invalid bridge chain type',
    },
    {
      description: 'get tx summaries should return null when xchainAssetIdent not exist',
      payload: {
        network: 'Ethereum',
        xchainAssetIdent: randomString(40, '0x', 'hex'),
        user: {
          network: 'Ethereum',
          ident: ETH_TEST_ADDRESS,
        },
      },
      result: [],
    },
    {
      description: 'get tx summaries should return error when user.network is invalid',
      payload: {
        network: 'Ethereum',
        xchainAssetIdent: randomString(40, '0x', 'hex'),
        user: {
          network: 'Invalid',
          ident: ETH_TEST_ADDRESS,
        },
      },
      error: 'Error: invalid address chain type',
    },
    {
      description: 'get tx summaries should return null when user.ident not exist',
      payload: {
        network: 'Ethereum',
        xchainAssetIdent: randomString(40, '0x', 'hex'),
        user: {
          network: 'Ethereum',
          ident: randomString(40, '0x', 'hex'),
        },
      },
      result: [],
    },
  ];

  const balanceCases = [
    {
      description: 'getBalance should return error when miss network',
      payload: [
        {
          userIdent: ETH_TEST_ADDRESS,
          assetIdent: ETH_TOKEN_ADDRESS,
        },
      ],
      error: 'Error: invalid chain type',
    },
    {
      description: 'getBalance should return error when miss userIdent',
      payload: [
        {
          network: 'Ethereum',
          assetIdent: ETH_TOKEN_ADDRESS,
        },
      ],
      error: `Error: invalid eth address`,
    },
    {
      description: 'getBalance should return error when miss assetIdent',
      payload: [
        {
          network: 'Ethereum',
          userIdent: ETH_TEST_ADDRESS,
        },
      ],
      error: `Error: invalid eth address`,
    },
    {
      description: 'getETHBalance should return error when assetIdent is invalid',
      payload: [
        {
          network: 'Ethereum',
          assetIdent: ETH_TOKEN_ADDRESS + '00',
          userIdent: ETH_TEST_ADDRESS,
        },
      ],
      error: 'Error: invalid eth address',
    },
  ];

  const feeCases = [
    {
      description: 'should return error when amount less than minimalBridgeAmount ',
      payload: {
        network: 'Ethereum',
        xchainAssetIdent: ETH_TOKEN_ADDRESS,
        amount: '9999999999999',
      },
      error: 'Error: minimal bridge amount is 0.00001 ETH',
    },
    {
      description: 'should return error when miss network',
      payload: {
        xchainAssetIdent: ETH_TOKEN_ADDRESS,
        amount: '1000000000000000',
      },
      error: 'Error: invalid bridge chain type',
    },
    {
      description: 'should return error when miss xchainAssetIdent',
      payload: {
        network: 'Ethereum',
        amount: '1000000000000000',
      },
      error: `Error: invalid eth address`,
    },
    {
      description: 'should return error when miss amount',
      payload: {
        network: 'Ethereum',
        xchainAssetIdent: ETH_TOKEN_ADDRESS,
      },
      error: 'Error: Cannot convert undefined to a BigInt',
    },
    {
      description: 'should return error when network is invalid',
      payload: {
        network: 'Invalid',
        xchainAssetIdent: ETH_TOKEN_ADDRESS,
        amount: '1000000000000000',
      },
      error: 'Error: invalid bridge chain type',
    },
    {
      description: 'should return error when xchainAssetIdent is not in whitelist',
      payload: {
        network: 'Ethereum',
        xchainAssetIdent: randomString(40, '0x', 'hex'),
        amount: '1000000000000000',
      },
      error: 'Error: minimal amount not configed',
    },
    {
      description: 'should return error when amount is invalid',
      payload: {
        network: 'Ethereum',
        xchainAssetIdent: ETH_TOKEN_ADDRESS,
        amount: 'abc',
      },
      error: 'Error: Cannot convert abc to a BigInt',
    },
  ];
  return {
    lockCases,
    burnCases,
    txSummaryCases,
    balanceCases,
    feeCases,
  };
}

async function lock(
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
      lockResult = await client.request('generateBridgeInNervosTransaction', testcase.payload);
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

      const beforeBalance = await getBalance(client, testcase.payload.asset.ident, CKB_TEST_ADDRESS, ETH_TEST_ADDRESS);
      const { inFee } = await getFee(client, 'Ethereum', testcase.payload.asset.ident, testcase.payload.asset.amount);

      const signedTx = await wallet.signTransaction(unsignedTx);
      const lockTxHash = (await provider.sendTransaction(signedTx)).hash;
      logger.info('lockTxHash', lockTxHash);

      await checkTx(client, testcase.payload.asset.ident, lockTxHash, CKB_TEST_ADDRESS, ETH_TEST_ADDRESS);

      for (let j = 0; j < 3; j++) {
        const afterBalance = await getBalance(client, testcase.payload.asset.ident, CKB_TEST_ADDRESS, ETH_TEST_ADDRESS);

        const beforeSUDTBalance = new Amount(beforeBalance[0].amount, 0);
        let expectedSUDTBalance = beforeSUDTBalance.add(new Amount(testcase.payload.asset.amount, 0));
        expectedSUDTBalance = expectedSUDTBalance.sub(new Amount(inFee.fee.amount, 0));
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

async function burn(
  ckb: CKB,
  client: JSONRPCClient,
  CKB_PRI_KEY: string,
  CKB_TEST_ADDRESS: string,
  ETH_TEST_ADDRESS: string,
  testcases,
) {
  const casesLength = testcases.length;
  for (let i = 0; i < casesLength; i++) {
    const testcase = testcases[i];
    let burnResult;
    try {
      burnResult = await client.request('generateBridgeOutNervosTransaction', testcase.payload);
    } catch (e) {
      if (testcase.error) {
        logger.info(`error for testcase ${i} ${testcase.description}, error: ${e}, expected: ${testcase.error}`);
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
    if (testcase.send) {
      const beforeBalance = await getBalance(client, testcase.payload.asset, CKB_TEST_ADDRESS, ETH_TEST_ADDRESS);

      const signedTx = ckb.signTransaction(CKB_PRI_KEY)(burnResult.rawTransaction);

      const burnTxHash = await ckb.rpc.sendTransaction(signedTx);
      logger.info('burnTxHash', burnTxHash);
      await checkTx(client, testcase.payload.asset, burnTxHash, CKB_TEST_ADDRESS, ETH_TEST_ADDRESS);

      const afterBalance = await getBalance(client, testcase.payload.asset, CKB_TEST_ADDRESS, ETH_TEST_ADDRESS);
      assert(
        new Amount(beforeBalance[0].amount, 0).sub(new Amount(testcase.payload.amount, 0)).toString() ===
          new Amount(afterBalance[0].amount, 0).toString(),
      );
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

async function fee(client: JSONRPCClient, method, testcases) {
  const casesLength = testcases.length;
  for (let i = 0; i < casesLength; i++) {
    const testcase = testcases[i];
    try {
      await client.request(method, testcase.payload);
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
  }
}

async function getTransaction(client: JSONRPCClient, token_address, userNetwork, address) {
  const getTxPayload = {
    network: 'Ethereum',
    xchainAssetIdent: token_address,
    user: {
      network: userNetwork,
      ident: address,
    },
  };

  const txs = await client.request('getBridgeTransactionSummaries', getTxPayload);

  return txs;
}

async function getFee(client: JSONRPCClient, network, xchainAssetIdent, amount) {
  const payload = {
    network,
    xchainAssetIdent,
    amount,
  };
  const inFee = await client.request('getBridgeInNervosBridgeFee', payload);
  const outFee = await client.request('getBridgeOutNervosBridgeFee', payload);
  logger.info('inFee, outFee', inFee, outFee);
  return { inFee, outFee };
}

async function getBalance(client: JSONRPCClient, token_address, ckbAddress, ethAddress) {
  const assets = await client.request('getAssetList', {});

  const shadowIdent = assets.map((asset) => {
    if (asset.ident == token_address) {
      logger.info(asset.info);
      return asset.info.shadow.ident;
    }
  });

  const sudtBalancePayload = {
    network: 'Nervos',
    userIdent: ckbAddress,
    assetIdent: shadowIdent[0],
  };
  const ethBalancePayload = {
    network: 'Ethereum',
    userIdent: ethAddress,
    assetIdent: token_address,
  };
  const balance = await client.request('getBalance', [sudtBalancePayload, ethBalancePayload]);
  logger.info('balance', balance);
  return balance;
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

function randomString(length, prefix = '', options = '') {
  let outString = prefix;
  let inOptions = 'abcdefghijklmnopqrstuvwxyz0123456789';

  if (options == 'hex') {
    inOptions = 'abcdef0123456789';
  }

  for (let i = 0; i < length; i++) {
    outString += inOptions.charAt(Math.floor(Math.random() * inOptions.length));
  }

  return outString;
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
): Promise<void> {
  const ckb = new CKB(CKB_NODE_URL);

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
  const { lockCases, burnCases, txSummaryCases, balanceCases, feeCases } = generateCases(
    CKB_TEST_ADDRESS,
    ETH_TEST_ADDRESS,
    ETH_TOKEN_ADDRESS,
    bridgeEthAddress,
  );
  await lock(client, ETH_NODE_URL, ETH_PRI_KEY, CKB_TEST_ADDRESS, ETH_TEST_ADDRESS, lockCases);
  await burn(ckb, client, CKB_PRI_KEY, CKB_TEST_ADDRESS, ETH_TEST_ADDRESS, burnCases);
  await txSummaries(client, txSummaryCases);
  await balance(client, balanceCases);
  await fee(client, 'getBridgeInNervosBridgeFee', feeCases);
  await fee(client, 'getBridgeOutNervosBridgeFee', feeCases);
  logger.info('rpc-ci test pass!');
}
