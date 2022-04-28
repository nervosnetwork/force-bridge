import fs from 'fs';
import { core, Cell, Script, utils } from '@ckb-lumos/base';
import { SerializeWitnessArgs } from '@ckb-lumos/base/lib/core';
import { common } from '@ckb-lumos/common-scripts';
import { payFeeByFeeRate } from '@ckb-lumos/common-scripts/lib/common';
import { SECP_SIGNATURE_PLACEHOLDER, hashWitness } from '@ckb-lumos/common-scripts/lib/helper';
import { serializeMultisigScript } from '@ckb-lumos/common-scripts/lib/secp256k1_blake160_multisig';
import { key } from '@ckb-lumos/hd';
import {
  createTransactionFromSkeleton,
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
import { SerializeRCData, SerializeRcLockWitnessLock } from '@force-bridge/x/dist/ckb/tx-helper/generated/omni_lock';
import { ScriptType } from '@force-bridge/x/dist/ckb/tx-helper/indexer';
import { initLumosConfig } from '@force-bridge/x/dist/ckb/tx-helper/init_lumos_config';
import { getMultisigLock } from '@force-bridge/x/dist/ckb/tx-helper/multisig/multisig_helper';
import { getSmtRootAndProof } from '@force-bridge/x/dist/ckb/tx-helper/omni-smt';
import { CkbDeps, MultisigItem } from '@force-bridge/x/dist/config';
import { httpRequest } from '@force-bridge/x/dist/multisig/client';
import { privateKeyToCkbPubkeyHash, transactionSkeletonToJSON, writeJsonToFile } from '@force-bridge/x/dist/utils';
import { buildChangeValidatorsSigRawData } from '@force-bridge/x/dist/xchain/eth';
import { abi } from '@force-bridge/x/dist/xchain/eth/abi/ForceBridge.json';
import Safe, { EthersAdapter, ContractNetworksConfig } from '@gnosis.pm/safe-core-sdk';
import { SafeTransaction, SafeSignature } from '@gnosis.pm/safe-core-sdk-types';
import EthSignSignature from '@gnosis.pm/safe-core-sdk/dist/src/utils/signatures/SafeSignature';
import { Reader, normalizers } from 'ckb-js-toolkit';
import commander from 'commander';
import { ecsign, toRpcSig } from 'ethereumjs-util';
import { BigNumber, ethers } from 'ethers';
import { JSONRPCResponse } from 'json-rpc-2.0';

type XchainType = 'ETH' | 'BSC';

const XCHAIN_CELL_DATA = {
  ETH: '0x01',
  BSC: '0x02',
};

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
  .requiredOption('--xchain <xchain>', "'ETH' | 'BSC'")
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
    const ckbIndexerRPC = nonNullable(opts.ckbIndexerUrl || CkbIndexerRpc) as string;
    const chain = nonNullable(opts.chain || 'DEV') as 'LINA' | 'AGGRON4' | 'DEV';
    const xchain = nonNullable(opts.xchain) as XchainType;
    const xchainCellData = XCHAIN_CELL_DATA[xchain];
    if (!xchainCellData) throw new Error('invalid xchain param');

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
      const ownerCellTypescriptArgs = valInfos.ckb.ownerCellTypescriptArgs;
      const txSkeleton = await generateCkbChangeValTx(
        valInfos.ckb.oldValInfos,
        newMultisigItem,
        ckbPrivateKey,
        ckbRpcURL,
        ckbIndexerRPC,
        xchainCellData,
        ownerCellTypescriptArgs,
      );
      txInfo.ckb = {
        newMultisigScript: newMultisigItem,
        oldMultisigItem: valInfos.ckb.oldValInfos,
        signature: [],
        txSkeleton: txSkeleton.toJS(),
      };
    }

    if (valInfos.ckbOmnilock) {
      const newValsPubKeyHashes = valAddresses.map((val) => {
        return val.ckbPubkeyHash;
      });
      const newMultisigItem = {
        R: 0,
        M: valInfos.ckbOmnilock.newThreshold,
        publicKeyHashes: newValsPubKeyHashes,
      };
      const txSkeleton = await generateCkbOmnilockChangeValTx(
        ckbRpcURL,
        ckbIndexerRPC,
        ckbPrivateKey,
        valInfos.ckbOmnilock.oldValInfos,
        newMultisigItem,
        valInfos.ckbOmnilock.omnilockLockscript,
        valInfos.ckbOmnilock.omnilockAdminCellTypescript,
        valInfos.ckbOmnilock.deps,
      );
      txInfo.ckbOmnilock = {
        newMultisigScript: newMultisigItem,
        oldMultisigItem: valInfos.ckbOmnilock.oldValInfos,
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

    if (valInfos.ethGnosisSafe) {
      const newValsEthAddrs = valAddresses.map((val) => {
        return val.ethAddress;
      });
      txInfo.ethGonosisSafe = await generatEthGnosisSafeChangeValidatorTx(
        newValsEthAddrs,
        valInfos.ethGnosisSafe.threshold,
        valInfos.ethGnosisSafe.safeAddress,
        ethRpc,
        valInfos.ethGnosisSafe.contractNetworks,
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

    if (valInfos.ckbOmnilock) {
      valInfos.ckbOmnilock.signature!.push(await signCkbOmnilockChangeValTx(valInfos.ckbOmnilock, ckbPrivateKey));
    }

    if (valInfos.eth) {
      const sig = await signEthChangeValTx(valInfos.eth, ethPrivateKey);
      valInfos.eth.signature!.push(sig);
    }
    if (valInfos.ethGonosisSafe) {
      valInfos.ethGonosisSafe = await signEthGnosisSafeValidatorTx(valInfos.ethGonosisSafe, ethPrivateKey);
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
    const ckbIndexerRPC = nonNullable(opts.ckbIndexerUrl || CkbIndexerRpc) as string;
    const ethPrivateKey = nonNullable(opts.ethPrivateKey) as string;
    const files = fs.readdirSync(changeValidatorTxSigDir);
    const ckbSignatures: string[] = [];
    const ethSignatures: string[] = [];
    const ckbOmnilockSignatures: string[] = [];
    const ethSafeSignatures: Map<string, SafeSignature[]> = new Map();
    const rawTx: ChangeVal = JSON.parse(fs.readFileSync(changeValidatorTxPath, 'utf8').toString());

    for (const file of files) {
      const valInfos: ChangeVal = JSON.parse(fs.readFileSync(`${changeValidatorTxSigDir}${file}`, 'utf8').toString());
      if (valInfos.eth && valInfos.eth!.signature && valInfos.eth!.signature.length !== 0) {
        ethSignatures.push(valInfos.eth.signature[0]);
      }

      if (valInfos.ethGonosisSafe) {
        for (const hash in valInfos.ethGonosisSafe.signatures) {
          let signatures = ethSafeSignatures.get(hash);
          if (!signatures) {
            signatures = [];
          }

          signatures.push(valInfos.ethGonosisSafe.signatures[hash]);
          ethSafeSignatures.set(hash, signatures);
        }
      }

      if (
        valInfos.ckb &&
        ckbSignatures.length < rawTx.ckb!.oldMultisigItem.M &&
        valInfos.ckb!.signature &&
        valInfos.ckb!.signature.length !== 0
      ) {
        ckbSignatures.push(valInfos.ckb.signature[0]);
      }

      if (
        valInfos.ckbOmnilock &&
        ckbOmnilockSignatures.length < rawTx.ckbOmnilock!.oldMultisigItem.M &&
        valInfos.ckbOmnilock!.signature &&
        valInfos.ckbOmnilock!.signature.length !== 0
      ) {
        ckbOmnilockSignatures.push(valInfos.ckbOmnilock.signature[0]);
      }
    }
    if (rawTx.ckb) {
      await sendCkbChangeValTx(rawTx.ckb, ckbPrivateKey, ckbRpcURL, ckbIndexerRPC, ckbSignatures);
    }

    if (rawTx.ckbOmnilock) {
      await sendCkbOmnilockChangeValTx(
        rawTx.ckbOmnilock,
        ckbPrivateKey,
        ckbRpcURL,
        ckbIndexerRPC,
        ckbOmnilockSignatures,
      );
    }

    if (rawTx.eth) {
      await sendEthChangeValTx(rawTx.eth.msg, ethPrivateKey, ethRpc, rawTx.eth.contractAddr, ethSignatures);
    }

    if (rawTx.ethGonosisSafe) {
      await sendEthGnosisSafeValidatorTx(rawTx.ethGonosisSafe, ethPrivateKey, ethSafeSignatures);
    }
  } catch (e) {
    console.error(`failed to send tx by `, e);
  }
}

async function getOmnilockOldCells(
  omniLockScript: Script,
  omniLockAdminCellTypescript: Script,
  cli: CkbTxHelper,
): Promise<Cell> {
  const oldCells = await cli.indexer.getCells({
    script: omniLockScript,
    script_type: ScriptType.lock,
    filter: {
      script: omniLockAdminCellTypescript,
    },
  });

  return oldCells[0];
}

function generateAdminCell(
  multiSigItem: MultisigItem,
  omniLockScript: Script,
  omniLockAdminCellTypescript: Script,
): Cell {
  const { root } = getSmtRootAndProof(multiSigItem);
  const serializedRcData = SerializeRCData({
    type: 'RCRule',
    value: {
      smt_root: new Reader(root).toArrayBuffer(),
      flags: 2,
    },
  });

  const adminCell = {
    cell_output: {
      capacity: '0x0',
      lock: omniLockScript,
      type: omniLockAdminCellTypescript,
    },
    data: new Reader(serializedRcData).serializeJson(),
  };
  adminCell.cell_output.capacity = `0x${minimalCellCapacity(adminCell).toString(16)}`;

  return adminCell;
}

async function generateCkbOmnilockChangeValTx(
  ckbRpcURL: string,
  ckbIndexerRpcUrl: string,
  ckbPrivateKey: string,
  oldMultisigCell: MultisigItem,
  newMultisigItem: MultisigItem,
  omnilockLockscript: Script,
  omniLockAdminCellTypescript: Script,
  ckbDeps: CkbDeps,
): Promise<TransactionSkeletonType> {
  const cli = new CkbTxHelper(ckbRpcURL, ckbIndexerRpcUrl);

  let txSkeleton = TransactionSkeleton({ cellProvider: cli.indexer });

  const oldAdminCell = await getOmnilockOldCells(omnilockLockscript, omniLockAdminCellTypescript, cli);

  txSkeleton = txSkeleton.update('cellDeps', (cellDeps) => {
    return cellDeps.push({
      dep_type: ckbDeps.omniLock!.cellDep.depType,
      out_point: {
        tx_hash: ckbDeps.omniLock!.cellDep.outPoint.txHash,
        index: ckbDeps.omniLock!.cellDep.outPoint.index,
      },
    });
  });

  txSkeleton = txSkeleton.update('inputs', (inputs) => {
    return inputs.push(oldAdminCell);
  });

  txSkeleton = txSkeleton.update('outputs', (outputs) => {
    const newAdminCell = generateAdminCell(newMultisigItem, omnilockLockscript, omniLockAdminCellTypescript);
    return outputs.push(newAdminCell);
  });

  txSkeleton = txSkeleton.update('witnesses', (witnesses) => {
    return witnesses.push(
      new Reader(
        SerializeWitnessArgs(
          normalizers.NormalizeWitnessArgs({
            lock: `0x${'0'.repeat(
              getOmnilockWitness([SECP_SIGNATURE_PLACEHOLDER.slice(2).repeat(oldMultisigCell.M)], oldMultisigCell)
                .length - 2,
            )}`,
          }),
        ),
      ).serializeJson(),
    );
  });

  const fromAddress = generateSecp256k1Blake160Address(key.privateKeyToBlake160(ckbPrivateKey));
  txSkeleton = await payFeeByFeeRate(txSkeleton, [fromAddress], 1000n);
  console.log(`OmniLock txSkeleton: ${transactionSkeletonToJSON(txSkeleton)}`);

  return txSkeleton;
}

async function generateCkbChangeValTx(
  oldMultisigItem: MultisigItem,
  newMultisigItem: MultisigItem,
  privateKey: string,
  ckbRpcURL: string,
  ckbIndexerURL: string,
  xchainCellData: string,
  ownerCellTypescriptArgs: string,
): Promise<TransactionSkeletonType> {
  const ckbClient = new CkbChangeValClient(ckbRpcURL, ckbIndexerURL);
  await ckbClient.indexer.waitForSync();
  const oldMultisigLockscript = getMultisigLock(oldMultisigItem);

  const newMultisigLockscript = getMultisigLock(newMultisigItem);
  const fromAddress = generateSecp256k1Blake160Address(key.privateKeyToBlake160(privateKey));
  let txSkeleton = TransactionSkeleton({ cellProvider: ckbClient.indexer });

  const oldOwnerCell = await ckbClient.fetchOwnerCell(oldMultisigLockscript, ownerCellTypescriptArgs);
  const oldMultisigCell = await ckbClient.fetchMultisigCell(oldMultisigLockscript, xchainCellData);

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
    data: xchainCellData,
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

async function signCkbOmnilockChangeValTx(ckbMsgInfo: CkbParams, ckbPrivKey: string): Promise<string> {
  const signerPubKeyHash = privateKeyToCkbPubkeyHash(ckbPrivKey);
  if (ckbMsgInfo.oldMultisigItem.publicKeyHashes.indexOf(signerPubKeyHash) === -1) {
    return Promise.reject('failed to sign the tx by wrong private key');
  }
  const txSkeleton = objectToTransactionSkeleton(ckbMsgInfo.txSkeleton);

  const hasher = new utils.CKBHasher();
  const rawTxHash = utils.ckbHash(
    core.SerializeRawTransaction(normalizers.NormalizeRawTransaction(createTransactionFromSkeleton(txSkeleton))),
  );
  hasher.update(rawTxHash);

  hashWitness(hasher, txSkeleton.get('witnesses').get(0)!);

  return key.signRecoverable(hasher.digestHex(), ckbPrivKey).slice(2);
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

function getOmnilockWitness(signatures: string[], multisigScript: MultisigItem): string {
  const serializedMultisigScript = serializeMultisigScript(multisigScript);
  const signature = signatures.join('');
  const { proof } = getSmtRootAndProof(multisigScript);
  const witness = {
    signature: new Reader(serializedMultisigScript + signature),
    rc_identity: {
      identity: new Reader(
        `0x06${new utils.CKBHasher().update(serializedMultisigScript).digestHex().slice(0, 42).slice(2)}`,
      ),
      proofs: [{ mask: 3, proof: new Reader(proof) }],
    },
  };

  return new Reader(SerializeRcLockWitnessLock(witness)).serializeJson();
}

async function sendCkbOmnilockChangeValTx(
  ckbMsgInfo: CkbParams,
  ckbPrivKey: string,
  ckbRpcURL: string,
  indexerURL: string,
  signatures: string[],
): Promise<void> {
  const cli = new CkbTxHelper(ckbRpcURL, indexerURL);
  let txSkeleton = objectToTransactionSkeleton(ckbMsgInfo.txSkeleton);

  txSkeleton = txSkeleton.update('witnesses', (witnesses) => {
    return witnesses.set(
      0,
      new Reader(
        SerializeWitnessArgs(
          normalizers.NormalizeWitnessArgs({
            lock: getOmnilockWitness(signatures, ckbMsgInfo.oldMultisigItem),
          }),
        ),
      ).serializeJson(),
    );
  });

  txSkeleton = txSkeleton.update('witnesses', (witnesses) => {
    for (let i = 1; i < witnesses.count(); i++) {
      const witness = witnesses.get(i);
      if (!witness) {
        return witnesses;
      }

      const hasher = new utils.CKBHasher();
      const rawTxHash = utils.ckbHash(
        core.SerializeRawTransaction(normalizers.NormalizeRawTransaction(createTransactionFromSkeleton(txSkeleton))),
      );
      hasher.update(rawTxHash);
      hashWitness(hasher, witness);
      const sign = key.signRecoverable(hasher.digestHex(), ckbPrivKey);
      witnesses = witnesses.set(
        i,
        new Reader(
          SerializeWitnessArgs(
            normalizers.NormalizeWitnessArgs({
              lock: sign,
            }),
          ),
        ).serializeJson(),
      );
    }

    return witnesses;
  });

  const tx = createTransactionFromSkeleton(txSkeleton);
  console.log(`tx: ${JSON.stringify(tx)}`);

  const hash = await cli.ckb.send_transaction(tx, 'passthrough');
  await cli.waitUntilCommitted(hash);
  return;
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
  const hash = await ckbClient.ckb.send_transaction(tx, 'passthrough');
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

// The command will be executed twice while both adding and removing owners.
// Adding owners will be executed at the first time.
// Removing owners will be executed at last time.
async function generatEthGnosisSafeChangeValidatorTx(
  newValidators: string[],
  threshold: number,
  safeAddress: string,
  ethRpcURL: string,
  contractNetworks?: ContractNetworksConfig,
): Promise<EthGnosisSafeChangeValidatorTx> {
  const provider = new ethers.providers.JsonRpcProvider(ethRpcURL);
  const safe = await Safe.create({
    ethAdapter: new EthersAdapter({ ethers, signer: new ethers.Wallet(fakePrivKey, provider) }),
    safeAddress: safeAddress,
    contractNetworks: contractNetworks,
  });

  const currentThreshold = await safe.getThreshold();
  if (newValidators.length == 0 && currentThreshold == threshold) {
    throw new Error('nothing changed.');
  }

  if (threshold <= 0 && threshold > newValidators.length) {
    threshold = currentThreshold;
  }

  const oldValidators = await safe.getOwners();

  const validatorsToAdd = newValidators.filter((v) => {
    return oldValidators.indexOf(v) < 0;
  });

  const validatorsToRemove = oldValidators.filter((v) => {
    return newValidators.indexOf(v) < 0;
  });

  const txes: SafeTransaction[] = [];

  for (let i = 0; i < validatorsToAdd.length; i++) {
    txes.push(
      await safe.getAddOwnerTx({
        ownerAddress: validatorsToAdd[i],
        threshold: i == validatorsToAdd.length - 1 ? threshold : undefined,
      }),
    );
  }

  if (validatorsToAdd.length == 0) {
    for (const validator of validatorsToRemove) {
      txes.push(await safe.getRemoveOwnerTx({ ownerAddress: validator, threshold }));
    }
  }

  if (validatorsToAdd.length == 0 && validatorsToRemove.length == 0 && currentThreshold != threshold) {
    txes.push(await safe.getChangeThresholdTx(threshold));
  }

  return {
    contractNetworks,
    safeAddress,
    txes,
    url: ethRpcURL,
  };
}

async function signEthGnosisSafeValidatorTx(
  tx: EthGnosisSafeChangeValidatorTx,
  ethPrivateKey: string,
): Promise<EthGnosisSafeChangeValidatorTx> {
  const provider = new ethers.providers.JsonRpcProvider(tx.url);
  const safe = await Safe.create({
    ethAdapter: new EthersAdapter({ ethers, signer: new ethers.Wallet(ethPrivateKey, provider) }),
    safeAddress: tx.safeAddress,
    contractNetworks: tx.contractNetworks,
  });

  tx.signatures = new Map();

  for (let i = 0; i < tx.txes.length; i++) {
    const hash = await safe.getTransactionHash(tx.txes[i]);
    tx.signatures[hash] = await safe.signTransactionHash(await safe.getTransactionHash(tx.txes[i]));
  }

  return tx;
}

async function sendEthGnosisSafeValidatorTx(
  tx: EthGnosisSafeChangeValidatorTx,
  ethPrivateKey: string,
  signatures: Map<string, SafeSignature[]>,
): Promise<void> {
  const provider = new ethers.providers.JsonRpcProvider(tx.url);
  const safe = await Safe.create({
    ethAdapter: new EthersAdapter({ ethers, signer: new ethers.Wallet(ethPrivateKey, provider) }),
    safeAddress: tx.safeAddress,
    contractNetworks: tx.contractNetworks,
  });

  for (const safeTransaction of tx.txes) {
    const tx = await safe.createTransaction(safeTransaction.data);
    const hash = await safe.getTransactionHash(safeTransaction);
    const signature = signatures.get(hash);
    if (signature == undefined) {
      continue;
    }

    for (const v of signature) {
      tx.addSignature(new EthSignSignature(v.signer, v.data));
    }

    await safe.executeTransaction(tx);
  }
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

  async fetchOwnerCell(lockScript: Script, ownerCellTypescriptArgs: string): Promise<Cell | undefined> {
    const cellCollector = this.indexer.collector({
      lock: lockScript,
      data: '0x',
    });
    for await (const cell of cellCollector.collect()) {
      if (cell.cell_output.type && cell.cell_output.type.args === ownerCellTypescriptArgs) {
        return cell;
      }
    }
  }

  async fetchMultisigCell(lockScript: Script, xchainCellData: string): Promise<Cell | undefined> {
    const cellCollector = this.indexer.collector({
      lock: lockScript,
      data: xchainCellData,
    });
    for await (const cell of cellCollector.collect()) {
      if (cell.cell_output.type === null && cell.data === xchainCellData) {
        return cell;
      }
    }
  }
}

export interface ValInfos {
  ckb?: {
    oldValInfos: MultisigItem;
    newThreshold: number;
    deps: CkbDeps;
    ownerCellTypescriptArgs: string;
  };
  ckbOmnilock?: {
    oldValInfos: MultisigItem;
    newThreshold: number;
    omnilockLockscript: Script;
    omnilockAdminCellTypescript: Script;
    deps: CkbDeps;
    ownerCellTypescriptArgs: string;
  };
  eth?: {
    oldValidators: string[];
    contractAddr: string;
    newThreshold: number;
  };
  ethGnosisSafe?: {
    safeAddress: string;
    contractNetworks?: ContractNetworksConfig;
    threshold: number;
  };
  newValRpcURLs: string[];
}

export interface ChangeVal {
  ckb?: CkbParams;
  ckbOmnilock?: CkbParams;
  eth?: EthParams;
  ethGonosisSafe?: EthGnosisSafeChangeValidatorTx;
}

export interface EthGnosisSafeChangeValidatorTx {
  safeAddress: string;
  contractNetworks?: ContractNetworksConfig;
  signatures?: Map<string, SafeSignature>;
  txes: SafeTransaction[];
  url: string;
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
