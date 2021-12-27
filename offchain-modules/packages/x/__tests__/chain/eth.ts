import { KeyStore } from '@force-bridge/keystore';
import fs from 'fs';
import { ethers } from 'ethers';
import { keccak256, toUtf8Bytes } from 'ethers/lib/utils';
import { random } from 'lodash';
import { Config } from '../../src/config';
import { bootstrap } from '../../src/core';
import { EthChain } from '../../src/xchain/eth';
import { abi as mirroAbi } from '../../src/xchain/eth/abi/NervosMirrorToken.json';

jest.setTimeout(1000000);
const ckbId = keccak256(toUtf8Bytes('ckb'));
let chain: EthChain;
let ckb: ethers.Contract;

beforeAll(async () => {
  const store = KeyStore.createFromPairs(
    {
      collector: 'de1566503947a71ae37765e151f16e4062256f4ccafa3601349551fb707df225',
      signer1: 'a4c1ec47222938e8ed4ee1aa772d6cdb5d65394e032b9822cdd7a99fe4e8dd7a',
      signer2: '21f48c96f40763150c6a33239821924d5f5321b3baa5d561929a2f1b0ccfddf3',
      signer3: '15d52c3700fd7d657cedd9e7b3cdc6caadff345b1736abb29125eaf12f78eb4a',
    },
    '',
  );
  store.getEncryptedData();
  fs.writeFileSync('keystore.json', JSON.stringify(store.getEncryptedData()));

  const config: Config = {
    common: {
      role: 'collector',
      log: {
        level: 'debug',
      },
      network: 'testnet',
      lumosConfigType: 'DEV',
      openMetric: false,
      collectorPubKeyHash: [],
    },
    ckb: {} as any,
    eos: {} as any,
    tron: {} as any,
    btc: {} as any,
    eth: {
      rpcUrl: 'https://goerli.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161',
      contractAddress: '0xF963589f36D740403e03D7A71C5A683c23AfbED4',
      privateKey: 'collector',
      multiSignHosts: [],
      multiSignAddresses: [],
      multiSignThreshold: 3,
      confirmNumber: 2,
      startBlockHeight: 0,
      assetWhiteList: [],
      assetManagerContractAddress: '0x2eFDbEbfE29e00B0dE1EE8C80F36F6506c1809f9',
      safeMultisignContractAddress: '0xF963589f36D740403e03D7A71C5A683c23AfbED4',
    },
  };
  await bootstrap(config)
  chain = new EthChain('collector');
  ckb = new ethers.Contract('0x84cd39ad57d01ad7c8e129ee5bbec6ddb51269ed', mirroAbi, chain.provider); 
})

afterAll(async () => {
  fs.unlinkSync('keystore.json');
})

describe('mint', () => {
  it('balance', async () => {
    const recipient = ethers.Wallet.createRandom();
    const mint = [{
      ckbTxHash: ethers.utils.hexlify(random()),
      asset: ckbId,
      recipientAddress: recipient.address,
      amount: random(10000).toString(10),
      ethTxHash: '',
    }];
    const res = await chain.sendMintTxs(mint);
    console.log(res);
    // const collector = new ethers.Wallet('de1566503947a71ae37765e151f16e4062256f4ccafa3601349551fb707df225', provider);
    // const signer1 = new ethers.Wallet('a4c1ec47222938e8ed4ee1aa772d6cdb5d65394e032b9822cdd7a99fe4e8dd7a', provider);
    // const signer2 = new ethers.Wallet('21f48c96f40763150c6a33239821924d5f5321b3baa5d561929a2f1b0ccfddf3', provider);
    // const signer3 = new ethers.Wallet('15d52c3700fd7d657cedd9e7b3cdc6caadff345b1736abb29125eaf12f78eb4a', provider);
    // const adapter = new EthersAdapter({ ethers, signer: collector });
    // const safe = await Safe.create({ ethAdapter: adapter, safeAddress: '0xF963589f36D740403e03D7A71C5A683c23AfbED4' });
    // const safe1 = await safe.connect({ ethAdapter: new EthersAdapter({ ethers, signer: signer1 }) });
    // const safe2 = await safe.connect({ ethAdapter: new EthersAdapter({ ethers, signer: signer2 }) });
    // const safe3 = await safe.connect({ ethAdapter: new EthersAdapter({ ethers, signer: signer3 }) });
    // const asset = new ethers.Contract('0x2eFDbEbfE29e00B0dE1EE8C80F36F6506c1809f9', assetAbi, provider).connect(
    //   collector,
    // );
    // const partialTx = {
    //   to: asset.address,
    //   value: '0',
    //   data: asset.interface.encodeFunctionData('mint', [
    //     [
    //       {
    //         assetId: ckbId,
    //         to: collector.address,
    //         amount: 1,
    //         lockId: 1,
    //       },
    //     ],
    //   ]),
    // };
    // const tx = await safe.createTransaction(partialTx);
    // tx.addSignature(await safe1.signTransactionHash(await safe1.getTransactionHash(tx)));
    // tx.addSignature(await safe2.signTransactionHash(await safe1.getTransactionHash(tx)));
    // tx.addSignature(await safe3.signTransactionHash(await safe1.getTransactionHash(tx)));
    // const r = await safe.executeTransaction(tx);
    // console.log(r);
    // {
    // 'assetId': ckbId,
    // 'to': collector.address,
    // 'amount': 1,
    // 'lockId': 1,
    // });
    // console.log(r);
    // const partialTx = asset.interface.encodeFunctionData('mint', })
  });
});
