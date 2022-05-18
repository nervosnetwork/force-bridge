import fs from 'fs';
import path from 'path';
import Safe, { SafeFactory, EthersAdapter, ContractNetworksConfig, EthSignSignature } from '@gnosis.pm/safe-core-sdk';
import { SafeTransaction, SafeSignature } from '@gnosis.pm/safe-core-sdk-types';
import { Contract, ethers, Wallet } from 'ethers';
import { writeJsonToFile } from '../../utils';
import { logger } from '../../utils/logger';
import { abi as asabi, bytecode as asbytecode } from './abi/AssetManager.json';
import { abi, bytecode } from './abi/ForceBridge.json';
import { abi as gsabi, bytecode as gsbytecode } from './abi/GnosisSafe_SV1_3_0.json';
import { abi as msabi, bytecode as msbytecode } from './abi/MultiSend_SV1_3_0.json';
import { abi as mabi, bytecode as mbytecode } from './abi/NervosMirrorToken.json';
import { abi as pfabi, bytecode as pfbytecode } from './abi/ProxyFactory_SV1_3_0.json';

export async function deployEthContract(
  rpcUrl: string,
  ethPrivateKey: string,
  validators: string[],
  multiSignThreshold: number,
): Promise<string> {
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(ethPrivateKey, provider);
  const bridgeFactory = new ethers.ContractFactory(abi, bytecode, wallet);
  const bridgeContract = await bridgeFactory.deploy(validators, multiSignThreshold);
  const receipt = await bridgeContract.deployTransaction.wait();
  logger.info(`deploy eth tx receipt is ${JSON.stringify(receipt)}`);
  if (receipt.status !== 1) {
    logger.info(`failed to deploy bridge contract.`);
    return Promise.reject('failed to deploy bridge contract');
  }

  return bridgeContract.address;
}

export async function deployAssetManager(url: string, privateKey: string, safeAddress: string): Promise<Contract> {
  const assetManagerContract = await new ethers.ContractFactory(
    asabi,
    asbytecode,
    new Wallet(privateKey, new ethers.providers.JsonRpcProvider(url)),
  ).deploy();
  const receipt = await assetManagerContract.deployTransaction.wait();
  logger.info(`deploy eth asset manager tx receipt is ${JSON.stringify(receipt)}`);
  if (receipt.status !== 1) {
    logger.info(`failed to deploy asset manager contract.`);
    return Promise.reject('failed to deploy asset manager contract');
  }

  await assetManagerContract.transferOwnership(safeAddress);
  logger.info(`Asset Manager Contract has been transfered to safe address: ${safeAddress}`);

  return assetManagerContract;
}

export async function unsignedAddEthMirrorTxToFile(
  url: string,
  safeAddress: string,
  assetManagerAddress: string,
  mirrorTokenAddress: string,
  typeHash: string,
  privateKey: string,
  outputPath: string,
  contractNetworks?: ContractNetworksConfig,
): Promise<void> {
  const wallet = new Wallet(privateKey, new ethers.providers.JsonRpcProvider(url));
  const safe = await Safe.create({
    ethAdapter: new EthersAdapter({ ethers, signer: wallet }),
    safeAddress: safeAddress,
    contractNetworks: contractNetworks,
  });

  const assetManagerContract = new Contract(assetManagerAddress, asabi);

  writeJsonToFile(
    {
      signature: {},
      url: url,
      safeAddress: safeAddress,
      contractNetworks: contractNetworks,
      tx: await safe.createTransaction({
        to: assetManagerAddress,
        value: '0',
        data: assetManagerContract.interface.encodeFunctionData('addAsset', [mirrorTokenAddress, typeHash]),
      }),
    },
    outputPath,
  );
}

export async function signAddEthMirrorTxToFile(filePath: string, privateKey: string): Promise<void> {
  const infos = JSON.parse(fs.readFileSync(filePath).toString());

  const provider = new ethers.providers.JsonRpcProvider(infos.url);
  const safe = await Safe.create({
    ethAdapter: new EthersAdapter({ ethers, signer: new ethers.Wallet(privateKey, provider) }),
    safeAddress: infos.safeAddress,
    contractNetworks: infos.contractNetworks,
  });

  const hash = await safe.getTransactionHash(infos.tx);
  infos.signature = await safe.signTransactionHash(hash);

  writeJsonToFile(infos, filePath);
}

export async function sendEthMirrorTxFromFiles(filesPath: string, privateKey: string): Promise<void> {
  const files = fs.readdirSync(filesPath);
  const signatures: Array<SafeSignature> = [];
  let url = '';
  let safeAddress = '';
  let contractNetworks: ContractNetworksConfig | undefined = undefined;
  let tx: SafeTransaction | undefined = undefined;

  for (const file of files) {
    const infos = JSON.parse(fs.readFileSync(path.join(filesPath, file)).toString());
    signatures.push(infos.signature);
    url = infos.url;
    safeAddress = infos.safeAddress;
    contractNetworks = infos.contractNetworks;
    tx = infos.tx;
    fs.rmSync(path.join(filesPath, file));
  }

  if (!tx) {
    return;
  }

  const provider = new ethers.providers.JsonRpcProvider(url);
  const safe = await Safe.create({
    ethAdapter: new EthersAdapter({ ethers, signer: new ethers.Wallet(privateKey, provider) }),
    safeAddress: safeAddress,
    contractNetworks: contractNetworks,
  });

  tx = await safe.createTransaction(tx.data);
  for (const v of signatures) {
    tx.addSignature(new EthSignSignature(v.signer, v.data));
  }

  await safe.executeTransaction(tx);
}

export async function deployEthMirror(
  url: string,
  privateKey: string,
  name: string,
  symbol: string,
  decimals: number,
  assetManagerContractAddress: string,
): Promise<Contract> {
  const contract = await new ethers.ContractFactory(
    mabi,
    mbytecode,
    new Wallet(privateKey, new ethers.providers.JsonRpcProvider(url)),
  ).deploy(name, symbol, decimals);
  const receipt = await contract.deployTransaction.wait();

  await (await contract.transferOwnership(assetManagerContractAddress)).wait();

  logger.info(`deploy eth mirror ${name} tx receipt is ${JSON.stringify(receipt)}`);

  return contract;
}

export async function deploySafe(
  url: string,
  privateKey: string,
  threshold: number,
  owners: string[],
): Promise<{ safeAddress: string; contractNetworks?: ContractNetworksConfig }> {
  const provider = new ethers.providers.JsonRpcProvider(url);
  const signer = new Wallet(privateKey, new ethers.providers.JsonRpcProvider(url));
  const chainId = (await provider.getNetwork()).chainId;

  // 1234 chain id is based on the config of Dockerfile.
  // 97 is for bsc testnet.
  if (chainId == 1234 || chainId == 97) {
    const safeProxyFactoryContract = await new ethers.ContractFactory(pfabi, pfbytecode, signer).deploy();
    let receipt = await safeProxyFactoryContract.deployTransaction.wait();
    logger.info(`deploy eth safe proxy factory tx receipt is ${JSON.stringify(receipt)}`);
    const safeMasterCopyContract = await new ethers.ContractFactory(gsabi, gsbytecode, signer).deploy();
    receipt = await safeMasterCopyContract.deployTransaction.wait();
    logger.info(`deploy eth safe master copy tx receipt is ${JSON.stringify(receipt)}`);
    const multiSendContract = await new ethers.ContractFactory(msabi, msbytecode, signer).deploy();
    receipt = await multiSendContract.deployTransaction.wait();
    logger.info(`deploy eth multi send tx receipt is ${JSON.stringify(receipt)}`);
    const networks = {
      [chainId]: {
        multiSendAddress: multiSendContract.address,
        safeMasterCopyAddress: safeMasterCopyContract.address,
        safeProxyFactoryAddress: safeProxyFactoryContract.address,
      },
    };

    logger.info(`Gnosis Safe networks deployed: ${JSON.stringify(networks)}`);

    return {
      safeAddress: (
        await (
          await SafeFactory.create({
            ethAdapter: new EthersAdapter({ ethers, signer }),
            contractNetworks: networks,
          })
        ).deploySafe({ owners, threshold })
      ).getAddress(),
      contractNetworks: networks,
    };
  } else {
    return {
      safeAddress: (
        await (
          await SafeFactory.create({ ethAdapter: new EthersAdapter({ ethers, signer }) })
        ).deploySafe({ owners, threshold })
      ).getAddress(),
    };
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function buildSigRawData(domainSeparator: string, typeHash: string, records, nonce): string {
  return ethers.utils.keccak256(
    ethers.utils.solidityPack(
      ['bytes1', 'bytes1', 'bytes32', 'bytes32'],
      [
        '0x19',
        '0x01',
        domainSeparator,
        ethers.utils.keccak256(
          ethers.utils.defaultAbiCoder.encode(
            [
              'bytes32',
              ethers.utils.ParamType.from({
                components: [
                  { name: 'token', type: 'address' },
                  { name: 'recipient', type: 'address' },
                  { name: 'amount', type: 'uint256' },
                  { name: 'ckbTxHash', type: 'bytes' },
                ],
                name: 'records',
                type: 'tuple[]',
              }),
              'uint256',
            ],
            [typeHash, records, nonce],
          ),
        ),
      ],
    ),
  );
}

export function buildChangeValidatorsSigRawData(
  domainSeparator: string,
  typeHash: string,
  validators: string[],
  threshold: number,
  nonce: number,
): string {
  return ethers.utils.keccak256(
    ethers.utils.solidityPack(
      ['bytes1', 'bytes1', 'bytes32', 'bytes32'],
      [
        '0x19',
        '0x01',
        domainSeparator,
        ethers.utils.keccak256(
          ethers.utils.defaultAbiCoder.encode(
            ['bytes32', 'address[]', 'uint256', 'uint256'],
            [typeHash, validators, threshold, nonce],
          ),
        ),
      ],
    ),
  );
}
