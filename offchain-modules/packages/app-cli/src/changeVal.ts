import fs from 'fs';
import { Cell, Script } from '@ckb-lumos/base';
import { common } from '@ckb-lumos/common-scripts';
import { serializeMultisigScript } from '@ckb-lumos/common-scripts/lib/secp256k1_blake160_multisig';
import { key } from '@ckb-lumos/hd';
import {
  generateSecp256k1Blake160Address,
  minimalCellCapacity,
  objectToTransactionSkeleton,
  sealTransaction,
  TransactionSkeleton,
  TransactionSkeletonObject,
  TransactionSkeletonType,
} from '@ckb-lumos/helpers';
import { nonNullable } from '@force-bridge/x';
import { CkbTxHelper } from '@force-bridge/x/dist/ckb/tx-helper/base_generator';
import { initLumosConfig } from '@force-bridge/x/dist/ckb/tx-helper/init_lumos_config';
import { getMultisigLock } from '@force-bridge/x/dist/ckb/tx-helper/multisig/multisig_helper';
import { MultisigItem } from '@force-bridge/x/dist/config';
import { httpRequest } from '@force-bridge/x/dist/multisig/client';
import { privateKeyToCkbPubkeyHash, transactionSkeletonToJSON, writeJsonToFile } from '@force-bridge/x/dist/utils';
import { buildChangeValidatorsSigRawData } from '@force-bridge/x/dist/xchain/eth';
import { abi } from '@force-bridge/x/dist/xchain/eth/abi/ForceBridge.json';
import commander from 'commander';
import { ecsign, toRpcSig } from 'ethereumjs-util';
import { BigNumber, ethers } from 'ethers';
import { JSONRPCResponse } from 'json-rpc-2.0';

const txWithSignatureDir = './';

const validitorInfos = './validitorInfos.json';
const changeValidatorRawTx = './changeValidatorRawTx.json';
const changeValidatorTxWithSig = `${txWithSignatureDir}changeValidatorTxWithSig.json`;

const EthNodeRpc = 'http://127.0.0.1:8545';
const CkbNodeRpc = 'http://127.0.0.1:8114';
const CkbIndexerRpc = 'http://127.0.0.1:8116';

const fakePrivKey = '0xc4ad657963930fbff2e9de3404b30a4e21432c89952ed430b56bf802945ed37a';

export const changeValCmd = new commander.Command('change-val');
changeValCmd
  .command('set')
  .option('-i, --input <input>', 'filepath of validators infos', validitorInfos)
  .option('-o, --output <output>', 'filepath of raw transaction which need request signature', changeValidatorRawTx)
  .requiredOption('-p, --ckbPrivateKey <ckbPrivateKey>', 'ckb private key ')
  .option('--ckbRpcUrl <ckbRpcUrl>', 'Url of ckb rpc', CkbNodeRpc)
  .option('--ckbIndexerUrl <ckbIndexerRpcUrl>', 'Url of ckb indexer url', CkbIndexerRpc)
  .option('--ethRpcUrl <ethRpcUrl>', 'Url of eth rpc', EthNodeRpc)
  .option('--chain <chain>', "'LINA' | 'AGGRON4' | 'DEV'", 'DEV')
  .action(doMakeTx)
  .description('generate raw transaction for change validator');

changeValCmd
  .command('sign')
  .requiredOption(
    '-i, --input <input>',
    'filepath of raw transaction which need request signature',
    changeValidatorRawTx,
  )
  .option('-o, --output <output>', 'filepath of transaction whit signature', changeValidatorTxWithSig)
  .requiredOption('--ckbPrivateKey <ckbPrivateKey>', 'ckb private key ')
  .requiredOption('--ethPrivateKey <ethPrivateKey>', 'eth private key ')
  .action(doSignTx)
  .description('sign the message of change validator');

changeValCmd
  .command('send')
  .option('-i, --input <input>', 'directory of transaction files with signature', txWithSignatureDir)
  .option('-s, --source <source>', 'filepath of raw transaction which need request signature', changeValidatorRawTx)
  .requiredOption('--ckbPrivateKey <ckbPrivateKey>', 'ckb private key ')
  .requiredOption('--ethPrivateKey <ethPrivateKey>', 'eth private key ')
  .option('--ckbRpcUrl <ckbRpcUrl>', 'Url of ckb rpc', CkbNodeRpc)
  .option('--ckbIndexerUrl <ckbIndexerRpcUrl>', 'Url of ckb indexer url', CkbIndexerRpc)
  .option('--ethRpcUrl <ethRpcUrl>', 'Url of eth rpc', EthNodeRpc)
  .action(doSendTx)
  .description('send the transaction for change validator');

async function doMakeTx(opts: Record<string, string>): Promise<void> {
  try {
    const validatorInfoPath = nonNullable(opts.input || validitorInfos);
    const changeValRawTxPath = nonNullable(opts.output || changeValidatorRawTx);
    const ethRpc = nonNullable(opts.ethRpcUrl || EthNodeRpc) as string;
    const ckbRpcURL = nonNullable(opts.ckbRpcUrl || CkbNodeRpc) as string;
    const ckbPrivateKey = nonNullable(opts.ckbPrivateKey) as string;
    const ckbIndexerRPC = nonNullable(opts.ckbIndexerRpcUrl || CkbIndexerRpc) as string;
    const chain = nonNullable(opts.chain || 'DEV') as 'LINA' | 'AGGRON4' | 'DEV';
    initLumosConfig(chain);
    const valInfos: ValInfos = JSON.parse(fs.readFileSync(validatorInfoPath, 'utf8').toString());

    const valPromises = valInfos.newValRpcURLs.map((host) => {
      return new Promise((resolve) => {
        httpRequest(`${host}/force-bridge/sign-server/api/v1`, 'status').then(
          (value) => {
            resolve(value);
          },
          (err) => {
            console.error(`Change Validators error. fail to get validators from  ${host}  error:${err.message}`);
            return;
          },
        );
      });
    });
    const valResponses = await Promise.all(valPromises);
    const valAddresses: addressConfig[] = [];
    for (const value of valResponses) {
      if (value === null) {
        return Promise.reject(`failed to get verifier info by rpc status interface`);
      }
      const resp = value as JSONRPCResponse;

      if (resp.error) {
        console.error(`failed to get verifier info by error`, resp.error);
        return Promise.reject(`failed to get verifier info by error ${JSON.stringify(resp.error, null, 2)}`);
      }

      const result = resp.result as statusResponse;
      valAddresses.push(result.addressConfig);
    }

    const txInfo: ChangeVal = {};

    if (valInfos.ckb) {
      const newValsPubKeyHashes = valAddresses.map((val) => {
        return val.ckbPubkeyHash;
      });
      const newMultisigItem = {
        R: 0,
        M: valInfos.ckb.newThreshold,
        publicKeyHashes: newValsPubKeyHashes,
      };
      const txSkeleton = await generateCkbChangeValTx(
        valInfos.ckb.oldValInfos,
        newMultisigItem,
        ckbPrivateKey,
        ckbRpcURL,
        ckbIndexerRPC,
      );
      txInfo.ckb = {
        newMultisigScript: newMultisigItem,
        oldMultisigItem: valInfos.ckb.oldValInfos,
        signature: [],
        txSkeleton: txSkeleton.toJS(),
      };
    }

    if (valInfos.eth) {
      const newValsEthAddrs = valAddresses.map((val) => {
        return val.ethAddress;
      });
      txInfo.eth = await generateEthChangeValTx(
        valInfos.eth.oldValidators,
        newValsEthAddrs,
        valInfos.eth.newThreshold,
        valInfos.eth.contractAddr,
        ethRpc,
      );
    }
    writeJsonToFile(txInfo, `${changeValRawTxPath}`);
  } catch (e) {
    console.error(`failed to generate tx by `, e);
  }
}
async function doSignTx(opts: Record<string, string>): Promise<void> {
  try {
    const changeValidatorTxPath = nonNullable(opts.input || changeValidatorRawTx);
    const txWithSigPath = nonNullable(opts.output || changeValidatorTxWithSig);
    const ckbPrivateKey = nonNullable(opts.ckbPrivateKey) as string;
    const ethPrivateKey = nonNullable(opts.ethPrivateKey) as string;

    const valInfos: ChangeVal = JSON.parse(fs.readFileSync(changeValidatorTxPath, 'utf8').toString());
    if (valInfos.ckb) {
      const sig = await signCkbChangeValTx(valInfos.ckb, ckbPrivateKey);
      valInfos.ckb.signature!.push(sig);
    }
    if (valInfos.eth) {
      const sig = await signEthChangeValTx(valInfos.eth, ethPrivateKey);
      valInfos.eth.signature!.push(sig);
    }
    writeJsonToFile(valInfos, `${txWithSigPath}`);
  } catch (e) {
    console.error(`failed to sign tx by `, e);
  }
}

async function doSendTx(opts: Record<string, string>): Promise<void> {
  try {
    const changeValidatorTxSigDir = nonNullable(opts.input || txWithSignatureDir);
    const changeValidatorTxPath = nonNullable(opts.source || changeValidatorRawTx);
    const ethRpc = nonNullable(opts.ethRpcUrl || EthNodeRpc) as string;
    const ckbRpcURL = nonNullable(opts.ckbRpcUrl || CkbNodeRpc) as string;
    const ckbPrivateKey = nonNullable(opts.ckbPrivateKey) as string;
    const ckbIndexerRPC = nonNullable(opts.ckbIndexerRpcUrl || CkbIndexerRpc) as string;
    const ethPrivateKey = nonNullable(opts.ethPrivateKey) as string;
    const files = fs.readdirSync(changeValidatorTxSigDir);
    const ckbSignatures: string[] = [];
    const ethSignatures: string[] = [];
    const rawTx: ChangeVal = JSON.parse(fs.readFileSync(changeValidatorTxPath, 'utf8').toString());

    for (const file of files) {
      const valInfos: ChangeVal = JSON.parse(fs.readFileSync(`${changeValidatorTxSigDir}${file}`, 'utf8').toString());
      if (valInfos.eth && valInfos.eth!.signature && valInfos.eth!.signature.length !== 0) {
        ethSignatures.push(valInfos.eth.signature[0]);
      }
      if (
        valInfos.ckb &&
        ckbSignatures.length < rawTx.ckb!.oldMultisigItem.M &&
        valInfos.ckb!.signature &&
        valInfos.ckb!.signature.length !== 0
      ) {
        ckbSignatures.push(valInfos.ckb.signature[0]);
      }
    }
    if (rawTx.ckb) {
      await sendCkbChangeValTx(rawTx.ckb, ckbPrivateKey, ckbRpcURL, ckbIndexerRPC, ckbSignatures);
    }

    if (rawTx.eth) {
      await sendEthChangeValTx(rawTx.eth.msg, ethPrivateKey, ethRpc, rawTx.eth.contractAddr, ethSignatures);
    }
  } catch (e) {
    console.error(`failed to send tx by `, e);
  }
}

async function generateCkbChangeValTx(
  oldMultisigItem: MultisigItem,
  newMultisigItem: MultisigItem,
  privateKey: string,
  ckbRpcURL: string,
  ckbIndexerURL: string,
): Promise<TransactionSkeletonType> {
  const ckbClient = new CkbChangeValClient(ckbRpcURL, ckbIndexerURL);
  await ckbClient.indexer.waitForSync();
  const oldMultisigLockscript = getMultisigLock(oldMultisigItem);

  const newMultisigLockscript = getMultisigLock(newMultisigItem);
  const fromAddress = generateSecp256k1Blake160Address(key.privateKeyToBlake160(privateKey));
  let txSkeleton = TransactionSkeleton({ cellProvider: ckbClient.indexer });

  const oldOwnerCell = await ckbClient.fetchCellWithMultisig(oldMultisigLockscript, 'owner');
  const oldMultisigCell = await ckbClient.fetchCellWithMultisig(oldMultisigLockscript, 'multisig');

  const newOwnerCell: Cell = {
    cell_output: {
      capacity: '0x0',
      lock: newMultisigLockscript,
      type: oldOwnerCell!.cell_output.type,
    },
    data: '0x',
  };
  newOwnerCell.cell_output.capacity = `0x${minimalCellCapacity(newOwnerCell).toString(16)}`;
  const newMultiCell: Cell = {
    cell_output: {
      capacity: '0x0',
      lock: newMultisigLockscript,
    },
    data: '0x',
  };
  newMultiCell.cell_output.capacity = `0x${minimalCellCapacity(newMultiCell).toString(16)}`;

  txSkeleton = await common.setupInputCell(txSkeleton, oldOwnerCell!, oldMultisigItem);
  txSkeleton = await common.setupInputCell(txSkeleton, oldMultisigCell!, oldMultisigItem);
  // setupInputCell will put an output same with input, clear it
  txSkeleton = txSkeleton.update('outputs', (outputs) => {
    return outputs.clear();
  });

  txSkeleton = txSkeleton.update('outputs', (outputs) => {
    return outputs.push(newOwnerCell).push(newMultiCell);
  });
  txSkeleton = await ckbClient.completeTx(txSkeleton, fromAddress);
  txSkeleton = common.prepareSigningEntries(txSkeleton);
  return txSkeleton;
}

async function signCkbChangeValTx(ckbMsgInfo: CkbParams, ckbPrivKey: string): Promise<string> {
  const signerPubKeyHash = privateKeyToCkbPubkeyHash(ckbPrivKey);
  if (ckbMsgInfo.oldMultisigItem.publicKeyHashes.indexOf(signerPubKeyHash) === -1) {
    return Promise.reject('failed to sign the tx by wrong private key');
  }
  const txSkeleton = objectToTransactionSkeleton(ckbMsgInfo.txSkeleton);
  const message = txSkeleton.signingEntries.get(1)!.message;
  return key.signRecoverable(message, ckbPrivKey).slice(2);
}

async function sendCkbChangeValTx(
  ckbMsgInfo: CkbParams,
  ckbPrivKey: string,
  ckbRpcURL: string,
  indexerURL: string,
  signatures: string[],
): Promise<void> {
  const ckbClient = new CkbChangeValClient(ckbRpcURL, indexerURL);
  const txSkeleton = objectToTransactionSkeleton(ckbMsgInfo.txSkeleton);

  const content0 = key.signRecoverable(txSkeleton.get('signingEntries').get(0)!.message, ckbPrivKey);
  let content1 = serializeMultisigScript({
    M: ckbMsgInfo.oldMultisigItem.M,
    R: ckbMsgInfo.oldMultisigItem.R,
    publicKeyHashes: ckbMsgInfo.oldMultisigItem.publicKeyHashes,
  });
  content1 += signatures.join('');

  console.debug(`txSkeleton: ${transactionSkeletonToJSON(txSkeleton)}`);
  const tx = sealTransaction(txSkeleton, [content0, content1]);
  const hash = await ckbClient.ckb.send_transaction(tx);
  console.log(`change tx hash ${hash}`);
  await ckbClient.waitUntilCommitted(hash);
  return;
}

async function generateEthChangeValTx(
  oldVals: string[],
  newVals: string[],
  threshold: number,
  contractAddr: string,
  ethRpcURL: string,
): Promise<EthParams> {
  const ethClient = new EthChangeValClient(ethRpcURL, contractAddr, fakePrivKey);
  const domainSeparator = await ethClient.bridge.DOMAIN_SEPARATOR();
  const typeHash = await ethClient.bridge.CHANGE_VALIDATORS_TYPEHASH();
  const nonce: BigNumber = await ethClient.bridge.latestChangeValidatorsNonce_();
  const msgHash = buildChangeValidatorsSigRawData(domainSeparator, typeHash, newVals, threshold, nonce.toNumber());
  const msg: EthMsg = {
    domainSeparator: domainSeparator,
    typeHash: typeHash,
    threshold: threshold,
    validators: newVals,
    nonce: nonce.toNumber(),
  };
  return {
    contractAddr: contractAddr,
    msg: msg,
    msgHash: msgHash,
    oldValidators: oldVals,
    signature: [],
  };
}

async function signEthChangeValTx(ethMsgInfo: EthParams, ethPrivKey: string): Promise<string> {
  const signerAddr = new ethers.Wallet(ethPrivKey).address;
  if (ethMsgInfo.oldValidators.indexOf(signerAddr) === -1) {
    return Promise.reject('failed to sign the tx by wrong private key');
  }
  const calcMsgHash = buildChangeValidatorsSigRawData(
    ethMsgInfo.msg.domainSeparator,
    ethMsgInfo.msg.typeHash,
    ethMsgInfo.msg.validators,
    ethMsgInfo.msg.threshold,
    ethMsgInfo.msg.nonce,
  );
  if (calcMsgHash !== ethMsgInfo.msgHash) {
    return Promise.reject('failed to sign the tx by msg is wrong');
  }
  const { v, r, s } = ecsign(Buffer.from(ethMsgInfo.msgHash.slice(2), 'hex'), Buffer.from(ethPrivKey.slice(2), 'hex'));
  const sigHex = toRpcSig(v, r, s);
  return sigHex.slice(2);
}
async function sendEthChangeValTx(
  ethMsgInfo: EthMsg,
  privKey: string,
  ethRpcURL: string,
  contractAddr: string,
  signatures: string[],
): Promise<void> {
  const ethClient = new EthChangeValClient(ethRpcURL, contractAddr, privKey);
  const signature = '0x' + signatures.join('');
  const res = await ethClient.bridge.changeValidators(
    ethMsgInfo.validators,
    ethMsgInfo.threshold,
    ethMsgInfo.nonce,
    signature,
  );
  console.debug('send change eth validators res', JSON.stringify(res, null, 2));
  const receipt = await res.wait();
  if (receipt.status !== 1) {
    console.error(`failed to execute change validator tx. tx recipient is `, receipt);
    return Promise.reject('failed to execute change validator tx');
  }
  return;
}

export class EthChangeValClient {
  protected readonly provider: ethers.providers.JsonRpcProvider;
  public readonly bridge: ethers.Contract;
  protected readonly wallet: ethers.Wallet;
  constructor(url: string, contractAddress: string, privateKey: string) {
    this.provider = new ethers.providers.JsonRpcProvider(url);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    this.bridge = new ethers.Contract(contractAddress, abi, this.provider).connect(this.wallet);
  }
}

export class CkbChangeValClient extends CkbTxHelper {
  constructor(ckbRpcUrl: string, ckbIndexerUrl: string) {
    super(ckbRpcUrl, ckbIndexerUrl);
  }

  async fetchCellWithMultisig(lockScript: Script, type: cell_type): Promise<Cell | undefined> {
    const cellCollector = this.indexer.collector({
      lock: lockScript,
    });
    for await (const cell of cellCollector.collect()) {
      if (type === 'multisig' && cell.cell_output.type === null) {
        return cell;
      }
      if (type === 'owner' && cell.cell_output.type) {
        return cell;
      }
    }
  }
}
type cell_type = 'owner' | 'multisig';

export interface ValInfos {
  ckb?: {
    oldValInfos: MultisigItem;
    newThreshold: number;
  };
  eth?: {
    oldValidators: string[];
    contractAddr: string;
    newThreshold: number;
  };
  newValRpcURLs: string[];
}

export interface ChangeVal {
  ckb?: CkbParams;
  eth?: EthParams;
}

export interface EthParams {
  oldValidators: string[];
  contractAddr: string;
  msgHash: string;
  msg: EthMsg;
  signature?: string[];
}
export interface CkbParams {
  oldMultisigItem: MultisigItem;
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
type statusResponse = {
  addressConfig: addressConfig;
  latestChainStatus?: {
    ckb: {
      latestCkbHeight: string;
      latestCkbBlockHash: string;
    };
    eth: {
      latestEthHeight: string;
      latestEthBlockHash: string;
    };
  };
};
type addressConfig = {
  ethAddress: string;
  ckbPubkeyHash: string;
  ckbAddress: string;
};
