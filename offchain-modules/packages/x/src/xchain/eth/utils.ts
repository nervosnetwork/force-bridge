import { SafeFactory, EthersAdapter } from '@gnosis.pm/safe-core-sdk';
import { Contract, ethers, Wallet } from 'ethers';
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

export async function deployAssetManager(
  url: string,
  privateKey: string,
  safeAddress: string,
  ckbToEthMirror: Array<{ assetId: string; name: string; symbol: string; decimals: number }>,
): Promise<Contract> {
  const contract = await new ethers.ContractFactory(
    asabi,
    asbytecode,
    new Wallet(privateKey, new ethers.providers.JsonRpcProvider(url)),
  ).deploy();
  const receipt = await contract.deployTransaction.wait();
  logger.info(`deploy eth asset manager tx receipt is ${JSON.stringify(receipt)}`);
  if (receipt.status !== 1) {
    logger.info(`failed to deploy asset manager contract.`);
    return Promise.reject('failed to deploy asset manager contract');
  }

  for (const v of ckbToEthMirror) {
    const ckbEthMirror = await deployEthMirror(url, privateKey, v.name, v.symbol, v.decimals);
    logger.info(`ckb mirror address: ${ckbEthMirror.address} asset id:${v.assetId}`);

    await (await ckbEthMirror.transferOwnership(contract.address)).wait();
    await (await contract.addAsset(ckbEthMirror.address, v.assetId)).wait();
    logger.info(`ckb mirror added to asset manager. address: ${ckbEthMirror.address} asset id:${v.assetId}`);
  }

  await contract.transferOwnership(safeAddress);
  logger.info(`Asset Manager Contract has been transfered to safe address: ${safeAddress}`);

  return contract;
}

export async function deployEthMirror(
  url: string,
  privateKey: string,
  name: string,
  symbol: string,
  decimals: number,
): Promise<Contract> {
  const contract = await new ethers.ContractFactory(
    mabi,
    mbytecode,
    new Wallet(privateKey, new ethers.providers.JsonRpcProvider(url)),
  ).deploy(name, symbol, decimals);
  const receipt = await contract.deployTransaction.wait();

  logger.info(`deploy eth mirror ${name} tx receipt is ${JSON.stringify(receipt)}`);

  return contract;
}

export async function deploySafe(
  url: string,
  privateKey: string,
  threshold: number,
  owners: string[],
): Promise<string> {
  const provider = new ethers.providers.JsonRpcProvider(url);
  const signer = new Wallet(privateKey, new ethers.providers.JsonRpcProvider(url));
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
    [(await provider.getNetwork()).chainId]: {
      multiSendAddress: multiSendContract.address,
      safeMasterCopyAddress: safeMasterCopyContract.address,
      safeProxyFactoryAddress: safeProxyFactoryContract.address,
    },
  };

  logger.info(`Gnosis Safe networks deployed: ${JSON.stringify(networks)}`);

  return (
    await (
      await SafeFactory.create({
        ethAdapter: new EthersAdapter({ ethers, signer }),
        contractNetworks: networks,
      })
    ).deploySafe({ owners, threshold })
  ).getAddress();
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
