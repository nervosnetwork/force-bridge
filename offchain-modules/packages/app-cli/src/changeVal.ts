import { Cell, Indexer, Script } from '@ckb-lumos/base';
import { common, secp256k1Blake160 } from '@ckb-lumos/common-scripts';
import { key } from '@ckb-lumos/hd';
import {
  objectToTransactionSkeleton,
  TransactionSkeletonObject,
  generateSecp256k1Blake160Address,
  minimalCellCapacity,
  parseAddress,
  sealTransaction,
  TransactionSkeleton,
  TransactionSkeletonType,
} from '@ckb-lumos/helpers';

import { nonNullable } from '@force-bridge/x';
import { CkbTxHelper } from '@force-bridge/x/dist/ckb/tx-helper/base_generator';
import { getMultisigLock } from '@force-bridge/x/dist/ckb/tx-helper/multisig/multisig_helper';
import { generateTypeIDScript } from '@force-bridge/x/dist/ckb/tx-helper/multisig/typeid';
import { MultisigItem } from '@force-bridge/x/dist/config';
import { logger } from '@force-bridge/x/dist/utils/logger';
import { buildChangeValidatorsSigRawData } from '@force-bridge/x/dist/xchain/eth';
import { abi } from '@force-bridge/x/dist/xchain/eth/abi/ForceBridge.json';
import commander from 'commander';
import { ecsign, toRpcSig } from 'ethereumjs-util';
import { ethers, BigNumber } from 'ethers';

const EthNodeRpc = 'http://127.0.0.1:8545';
const CkbNodeRpc = 'http://127.0.0.1:8114';
export const changeValCmd = new commander.Command('change-val');
changeValCmd
  .command('set')
  .requiredOption('-r, --recipient <recipient>', 'recipient address on eth')
  .requiredOption('-p, --privateKey <privateKey>', 'private key of unlock address on ckb')
  .requiredOption('-a, --amount <amount>', 'amount of unlock')
  .option('-s, --symbol <symbol>', 'token symbol', 'ckETH')
  .option('--ckbRpcUrl <ckbRpcUrl>', 'Url of ckb rpc', CkbNodeRpc)
  .option('-w, --wait', 'whether wait for transaction confirmed')
  .action(doMakeTx)
  .description('unlock asset on eth');
changeValCmd
  .command('sign')
  .requiredOption('-r, --recipient <recipient>', 'recipient address on eth')
  .requiredOption('-p, --privateKey <privateKey>', 'private key of unlock address on ckb')
  .requiredOption('-a, --amount <amount>', 'amount of unlock')
  .option('-s, --symbol <symbol>', 'token symbol', 'ckETH')
  .option('--ckbRpcUrl <ckbRpcUrl>', 'Url of ckb rpc', CkbNodeRpc)
  .option('-w, --wait', 'whether wait for transaction confirmed')
  .action(doSignTx)
  .description('unlock asset on eth');

changeValCmd
  .command('send')
  .requiredOption('-r, --recipient <recipient>', 'recipient address on eth')
  .requiredOption('-p, --privateKey <privateKey>', 'private key of unlock address on ckb')
  .requiredOption('-a, --amount <amount>', 'amount of unlock')
  .option('-s, --symbol <symbol>', 'token symbol', 'ckETH')
  .option('--ckbRpcUrl <ckbRpcUrl>', 'Url of ckb rpc', CkbNodeRpc)
  .option('-w, --wait', 'whether wait for transaction confirmed')
  .action(doSendTx)
  .description('unlock asset on eth');

async function doMakeTx() {
  logger.error('// TODO');
}
async function doSignTx() {
  logger.error('// TODO');
}
async function doSendTx() {
  logger.error('// TODO');
}

async function generateCkbChangeValTx(
  multisigItem: MultisigItem,
  privateKey: string,
  lockscript: Script,
): Promise<void> {
  const ckbClient = new CkbTx('', '');
  await ckbClient.indexer.waitForSync();
  const multisigLockscript = getMultisigLock(multisigItem);
  const fromAddress = generateSecp256k1Blake160Address(key.privateKeyToBlake160(privateKey));
  const fromLockscript = parseAddress(fromAddress);
  let txSkeleton = TransactionSkeleton({ cellProvider: this.indexer });
  const fromCells = await this.getFromCells(fromLockscript);
  if (fromCells.length === 0) {
    throw new Error('no available cells found');
  }
  const firstInputCell: Cell = nonNullable(fromCells[0]);
  txSkeleton = await common.setupInputCell(txSkeleton, firstInputCell);

  const multisigCell = await ckbClient.fetchMultisigCell(lockscript);
  if (multisigCell) {
    txSkeleton = await common.setupInputCell(txSkeleton, multisigCell);
  }

  // setupInputCell will put an output same with input, clear it
  txSkeleton = txSkeleton.update('outputs', (outputs) => {
    return outputs.clear();
  });
  // add owner cell
  const firstInput = {
    previous_output: firstInputCell.out_point,
    since: '0x0',
  };
  const ownerCellTypescript = generateTypeIDScript(firstInput, `0x0`);
  const ownerCell: Cell = {
    cell_output: {
      capacity: '0x0',
      lock: multisigLockscript,
      type: ownerCellTypescript,
    },
    data: '0x',
  };
  ownerCell.cell_output.capacity = `0x${minimalCellCapacity(ownerCell).toString(16)}`;
  // create an empty cell for the multi sig
  const multiCell: Cell = {
    cell_output: {
      capacity: '0x0',
      lock: multisigLockscript,
    },
    data: '0x',
  };
  multiCell.cell_output.capacity = `0x${minimalCellCapacity(multiCell).toString(16)}`;
  txSkeleton = txSkeleton.update('outputs', (outputs) => {
    return outputs.push(ownerCell).push(multiCell);
  });
  txSkeleton = await ckbClient.completeTx(txSkeleton, fromAddress, fromCells.slice(1));
}

async function signCkbChangeValTx(ckbMsgInfo: CkbConfig, ckbPrivKey: string) {
  const txSkeleton = objectToTransactionSkeleton(ckbMsgInfo.txSkeleton);
  const message = txSkeleton.signingEntries.get(1)!.message;
  const signature = key.signRecoverable(message, ckbPrivKey).slice(2);
}

async function sendCkbChangeValTx(ckbMsgInfo: CkbConfig, ckbPrivKey: string) {
  const ckbClient = new CkbTx('', '');
  const txSkeleton = objectToTransactionSkeleton(ckbMsgInfo.txSkeleton);
  const _hash = await ckbClient.SignAndSendTransaction(txSkeleton, ckbPrivKey);
}

async function generateEthChangeValTx(validators: string[], threshold: number) {
  const ethClient = new EthTX('', '', '');
  const domainSeparator = await ethClient.bridge.DOMAIN_SEPARATOR();
  const typeHash = await ethClient.bridge.CHANGE_VALIDATORS_TYPEHASH();
  const nonce: BigNumber = await ethClient.bridge.latestChangeValidatorsNonce_();
  const msgHash = buildChangeValidatorsSigRawData(domainSeparator, typeHash, validators, threshold, nonce.toNumber());
  const msg = {
    domainSeparator: domainSeparator,
    typeHash: typeHash,
    threshold: threshold,
    validators: validators,
    nonce: nonce,
  };
}

async function signEthChangeValTx(ethMsgInfo: EthConfig, ethPrivKey: string) {
  const signerAddr = new ethers.Wallet(ethPrivKey).address;
  if (ethMsgInfo.oldValidators.indexOf(signerAddr) === -1) {
    return Error('failed to sign the tx by wrong private key');
  }
  const calcMsgHash = buildChangeValidatorsSigRawData(
    ethMsgInfo.msg.domainSeparator,
    ethMsgInfo.msg.typeHash,
    ethMsgInfo.msg.validators,
    ethMsgInfo.msg.threshold,
    ethMsgInfo.msg.nonce,
  );
  if (calcMsgHash !== ethMsgInfo.msgHash) {
    return Error('failed to sign the tx by msg is wrong');
  }
  const { v, r, s } = ecsign(Buffer.from(ethMsgInfo.msgHash.slice(2), 'hex'), Buffer.from(ethPrivKey.slice(2), 'hex'));
  const sigHex = toRpcSig(v, r, s);
  const signature = sigHex.slice(2);
}
async function sendEthChangeValTx(ethMsgInfo: EthMsg, privKey: string) {
  const ethClient = new EthTX('', '', privKey);
  const signatures: string[] = [];
  const signature = '0x' + signatures.join('');
  return ethClient.bridge.changeValidators(ethMsgInfo.validators, ethMsgInfo.threshold, ethMsgInfo.nonce, signature);
}

export class EthTX {
  protected readonly provider: ethers.providers.JsonRpcProvider;
  public readonly bridge: ethers.Contract;
  protected readonly wallet: ethers.Wallet;
  constructor(url: string, contractAddress: string, privateKey: string) {
    this.provider = new ethers.providers.JsonRpcProvider(url);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    logger.debug('tx sender', this.wallet.address);
    this.bridge = new ethers.Contract(contractAddress, abi, this.provider).connect(this.wallet);
  }
}

export class CkbTx extends CkbTxHelper {
  constructor(ckbRpcUrl: string, ckbIndexerUrl: string) {
    super(ckbRpcUrl, ckbIndexerUrl);
  }

  async fetchMultisigCell(lockScript: Script): Promise<Cell | undefined> {
    const cellCollector = this.indexer.collector({
      lock: lockScript,
    });
    for await (const cell of cellCollector.collect()) {
      if (cell.cell_output.type === null) {
        return cell;
      }
    }
  }
  async SignAndSendTransaction(txSkeleton: TransactionSkeletonType, privateKey: string): Promise<string> {
    txSkeleton = await common.prepareSigningEntries(txSkeleton);
    const message = txSkeleton.get('signingEntries').get(0)!.message;
    const Sig = key.signRecoverable(message!, privateKey);
    const tx = sealTransaction(txSkeleton, [Sig]);
    const hash = await this.ckb.send_transaction(tx);
    await this.waitUntilCommitted(hash);
    return hash;
  }
}

export interface ChangeVal {
  ckb: CkbConfig;
  eth: EthConfig;
}

export interface EthConfig {
  oldValidators: string[];
  msgHash: string;
  msg: EthMsg;
  signature?: string[];
}
export interface CkbConfig {
  oldMultisigScript: MultisigItem;
  txSkeleton: TransactionSkeletonObject;
  newMultisigScript: MultisigItem;
  signature?: string[];
}
export interface EthMsg {
  domainSeparator: string;
  typeHash: string;
  threshold: number;
  validators: string[];
  nonce: number;
}
