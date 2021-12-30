import { ethers, Wallet } from 'ethers';
import { logger } from '../../utils/logger';
import { abi as asabi, bytecode as asbytecode } from './abi/AssetManager.json';
import { abi, bytecode } from './abi/ForceBridge.json';
// import { abi as gsabi, bytecode as gsbytecode } from './abi/GnosisSafe_SV1_3_0.json';
// import { abi as msabi, bytecode as msbytecode } from './abi/MultiSend_SV1_3_0.json';
// import { abi as pfabi, bytecode as pfbytecode } from './abi/ProxyFactory_SV1_3_0.json';

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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  safeAddress: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  threshold: number,
): Promise<string> {
  const contract = await new ethers.ContractFactory(
    asabi,
    asbytecode,
    new Wallet(privateKey, new ethers.providers.JsonRpcBatchProvider(url)),
  ).deploy();
  const receipt = await contract.deployTransaction.wait();
  logger.info(`deploy eth asset manager tx receipt is ${JSON.stringify(receipt)}`);
  if (receipt.status !== 1) {
    logger.info(`failed to deploy asset manager contract.`);
    return Promise.reject('failed to deploy asset manager contract');
  }

  return contract.address;
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
