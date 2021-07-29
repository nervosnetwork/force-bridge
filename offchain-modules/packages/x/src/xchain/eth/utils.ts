import { ethers } from 'ethers';
import { logger } from '../../utils/logger';
import { abi, bytecode } from './abi/ForceBridge.json';

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
