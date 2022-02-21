import { Cell, utils } from '@ckb-lumos/base';
import { common } from '@ckb-lumos/common-scripts';
import { getConfig } from '@ckb-lumos/config-manager';
import { key } from '@ckb-lumos/hd';
import {
  objectToTransactionSkeleton,
  parseAddress,
  TransactionSkeleton,
  TransactionSkeletonObject,
  TransactionSkeletonType,
} from '@ckb-lumos/helpers';
import { BtcAsset, ChainType, EosAsset, EthAsset, TronAsset } from '@force-bridge/x/dist/ckb/model/asset';
import { getOwnerTypeHash } from '@force-bridge/x/dist/ckb/tx-helper/multisig/multisig_helper';
import { getOmniLockMultisigAddress } from '@force-bridge/x/dist/ckb/tx-helper/multisig/omni-lock';
import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { EthBurn } from '@force-bridge/x/dist/db/entity/EthBurn';
import { EthLock } from '@force-bridge/x/dist/db/entity/EthLock';
import { asserts, nonNullable } from '@force-bridge/x/dist/errors';
import {
  ckbCollectSignaturesPayload,
  ckbCreateCellCollectSignaturesPayload,
  ckbMintCollectSignaturesPayload,
  ckbUnlockCollectSignaturesPayload,
  collectSignaturesParams,
  mintRecord,
  SigType,
  unlockRecord,
} from '@force-bridge/x/dist/multisig/multisig-mgr';
import { verifyCollector } from '@force-bridge/x/dist/multisig/utils';
import { compareCkbAddress } from '@force-bridge/x/dist/utils';
import { Amount } from '@lay2/pw-core';
import { SigError, SigErrorCode, SigErrorOk } from './error';
import { SigResponse, SigServer } from './sigServer';

async function verifyCreateCellTx(rawData: string, payload: ckbCreateCellCollectSignaturesPayload): Promise<SigError> {
  const txSkeleton = payload.txSkeleton;
  const sigData = txSkeleton.signingEntries[1].message;
  if (rawData !== sigData) {
    return new SigError(SigErrorCode.InvalidParams, `rawData:${rawData} doesn't match with:${sigData}`);
  }

  const createAssets = nonNullable(payload.createAssets);
  const ownerTypeHash = getOwnerTypeHash();
  const bridgeCells: Cell[] = [];
  txSkeleton.outputs.forEach((output) => {
    if (!output.cell_output.lock) {
      return;
    }
    if (output.cell_output.lock.code_hash === ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash) {
      bridgeCells.push(output);
    }
  });
  if (bridgeCells.length !== createAssets.length) {
    return new SigError(
      SigErrorCode.InvalidParams,
      `create bridge recode length:${bridgeCells.length} doesn't match with:${createAssets.length}`,
    );
  }
  for (let i = 0; i < createAssets.length; i++) {
    const createAsset = createAssets[i];
    let asset;
    switch (createAsset.chain) {
      case ChainType.BTC:
        asset = new BtcAsset(createAsset.asset, ownerTypeHash);
        break;
      case ChainType.ETH:
        asset = new EthAsset(createAsset.asset, ownerTypeHash);
        break;
      case ChainType.TRON:
        asset = new TronAsset(createAsset.asset, ownerTypeHash);
        break;
      case ChainType.EOS:
        asset = new EosAsset(createAsset.asset, ownerTypeHash);
        break;
      default:
        return new SigError(SigErrorCode.InvalidParams, `chain type:${createAsset.chain} doesn't support`);
    }

    const output = bridgeCells[i];
    const lockScript = output.cell_output.lock;
    if (output.data !== '0x') {
      return new SigError(
        SigErrorCode.InvalidRecord,
        `create bridge cell data:${output.data} doesn't match with 0x, asset chain:${createAsset.chain} address:${createAsset.asset}`,
      );
    }
    if (lockScript.args !== asset.toBridgeLockscriptArgs()) {
      return new SigError(
        SigErrorCode.InvalidRecord,
        `create bridge cell lockScript args:${
          lockScript.args
        } doesn't match with ${asset.toBridgeLockscriptArgs()}, asset chain:${createAsset.chain} address:${
          createAsset.asset
        }`,
      );
    }
    if (lockScript.hash_type !== ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType) {
      return new SigError(
        SigErrorCode.InvalidRecord,
        `create bridge cell lockScript hash_type:${lockScript.hash_type} doesn't match with ${ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType}, asset chain:${createAsset.chain} address:${createAsset.asset}`,
      );
    }
  }
  return SigErrorOk;
}

async function verifyDuplicateMintTx(
  pubKey: string,
  mintRecords: mintRecord[],
  _txSkeleton: TransactionSkeletonObject,
): Promise<SigError> {
  const refTxHashes = mintRecords.map((mintRecord) => {
    return mintRecord.id;
  });

  const mints = await SigServer.ckbDb.getCkbMintByIds(refTxHashes);
  if (mints.length !== 0) {
    return new SigError(SigErrorCode.TxCompleted);
  }

  return SigErrorOk;
}

async function verifyDuplicateUnlockTx(
  pubKey: string,
  unlockRecords: unlockRecord[],
  _txSkeleton: TransactionSkeletonObject,
): Promise<SigError> {
  const refTxHashes = unlockRecords.map((unlockRecord) => {
    return unlockRecord.id;
  });

  const unlocks = await SigServer.ckbDb.getCkbUnlockByIds(refTxHashes);
  if (unlocks.length !== 0) {
    return new SigError(SigErrorCode.TxCompleted);
  }

  return SigErrorOk;
}

async function verifyMintTx(
  pubKey: string,
  rawData: string,
  payload: ckbMintCollectSignaturesPayload,
): Promise<SigError> {
  const txSkeleton = payload.txSkeleton;
  const sigData = txSkeleton.signingEntries[1].message;
  if (rawData !== sigData) {
    return new SigError(SigErrorCode.InvalidParams, `rawData:${rawData} doesn't match with:${sigData}`);
  }
  const mintRecords = payload.mintRecords;
  asserts(mintRecords);

  let err = await verifyDuplicateMintTx(pubKey, mintRecords, txSkeleton);
  if (err.Code !== SigErrorCode.Ok) {
    return err;
  }

  const mintCells: Cell[] = [];
  txSkeleton.outputs.forEach((output) => {
    if (!output.cell_output.type) {
      return;
    }
    if (output.cell_output.type.code_hash === ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash) {
      mintCells.push(output);
    }
  });

  if (mintRecords.length !== mintCells.length) {
    return new SigError(
      SigErrorCode.InvalidParams,
      `mint recode length:${mintRecords.length} doesn't match with:${mintCells.length}`,
    );
  }

  const mintRecordsMap = new Map<number, mintRecord[]>();
  for (let i = 0; i < mintRecords.length; i++) {
    const mintRecord = mintRecords[i];
    if (
      mintRecord.chain === ChainType.BTC ||
      mintRecord.chain === ChainType.EOS ||
      mintRecord.chain === ChainType.TRON
    ) {
      //those chains doesn't verify now
      continue;
    }
    let records = mintRecordsMap.get(mintRecord.chain);
    if (!records) {
      records = [];
    }
    records.push(mintRecord);
    mintRecordsMap.set(mintRecord.chain, records);

    const output = mintCells[i];
    err = await verifyEthMintTx(mintRecord, output);
    if (err.Code !== SigErrorCode.Ok) {
      return err;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  err = await verifyEthMintRecords(mintRecordsMap.get(ChainType.ETH)!);
  if (err.Code !== SigErrorCode.Ok) {
    return err;
  }
  return SigErrorOk;
}

async function verifyUnlockTx(
  pubKey: string,
  rawData: string,
  payload: ckbUnlockCollectSignaturesPayload,
): Promise<SigError> {
  const omniLockMultisigScript = parseAddress(getOmniLockMultisigAddress());
  const txSkeleton = payload.txSkeleton;
  const sigData = txSkeleton.signingEntries[1].message;
  if (rawData !== sigData) {
    return new SigError(SigErrorCode.InvalidParams, `rawData:${rawData} doesn't match with:${sigData}`);
  }

  const unlockRecords = payload.unlockRecords;
  asserts(unlockRecords);

  let err = await verifyDuplicateUnlockTx(pubKey, unlockRecords, txSkeleton);
  if (err.Code !== SigErrorCode.Ok) {
    return err;
  }

  const sudtTypescript = ForceBridgeCore.config.ckb.deps.sudtType.script;
  if (
    txSkeleton.outputs.some(
      (output) => output.cell_output.type && output.cell_output.type.code_hash !== sudtTypescript.codeHash,
    )
  ) {
    return new SigError(SigErrorCode.InvalidParams, `unlock recode outputs contains non-sudt typescript`);
  }
  const omniLockHash = utils.computeScriptHash(omniLockMultisigScript);
  const omniOutputIndex = txSkeleton.outputs.findIndex((cell) => {
    const cellLockHash = utils.computeScriptHash(cell.cell_output.lock);
    return cellLockHash === omniLockHash;
  });
  const unlockCells = txSkeleton.outputs.slice(0, omniOutputIndex);
  if (unlockRecords.length !== unlockCells.length) {
    return new SigError(
      SigErrorCode.InvalidParams,
      `unlok recode length:${unlockRecords.length} doesn't match with:${unlockCells.length}`,
    );
  }

  const typeArgs = unlockCells.map((output) => {
    const typescript = output.cell_output.type;
    if (typescript) {
      return ForceBridgeCore.ckb.utils.scriptToHash({
        codeHash: typescript.code_hash,
        hashType: typescript.hash_type,
        args: typescript.args,
      });
    } else {
      return '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    }
  });

  if (new Set(typeArgs).size > 1) {
    return new SigError(SigErrorCode.InvalidParams, `unlock recode outputs contains not single typescript`);
  }

  for (let i = 0; i < unlockRecords.length; i++) {
    const unlockRecord = unlockRecords[i];
    if (unlockRecord.xchain !== ChainType.ETH) {
      //those chains doesn't verify now
      return new SigError(SigErrorCode.InvalidRecord, `unsupported xchain ${unlockRecord.xchain}`);
    }

    const output = unlockCells[i];
    err = await verifyEthForUnlockTx(unlockRecord, output);
    if (err.Code !== SigErrorCode.Ok) {
      return err;
    }
  }
  err = await verifyEthForUnlockRecords(unlockRecords);
  if (err.Code !== SigErrorCode.Ok) {
    return err;
  }

  return SigErrorOk;
}

async function verifyEthMintRecords(records: mintRecord[]): Promise<SigError> {
  const mintIds = records.map((record) => {
    return record.id;
  });
  const ethLocks = await SigServer.ethDb.getEthLocksByUniqueIds(mintIds);
  const ethLockMap = new Map<string, EthLock>();
  ethLocks.forEach((record) => {
    return ethLockMap.set(record.uniqueId, record);
  });

  for (const record of records) {
    const ethLock = ethLockMap.get(record.id);
    if (!ethLock) {
      return new SigError(SigErrorCode.TxNotFound, `cannot found eth lock tx by txHash:${record.id}`);
    }
    if (ethLock.confirmStatus !== 'confirmed') {
      return new SigError(SigErrorCode.TxUnconfirmed, `ethLockTx:${ethLock.txHash} doesn't confirmed`);
    }
    if (!compareCkbAddress(record.recipientLockscript, ethLock.recipient)) {
      return new SigError(
        SigErrorCode.InvalidRecord,
        `ethLockTxHash:${record.id} recipientLockscript:${record.recipientLockscript} != ${ethLock.recipient}`,
      );
    }
    if (record.asset != ethLock.token) {
      return new SigError(
        SigErrorCode.InvalidRecord,
        `ethLockTxHash:${record.id} asset:${record.asset} != ${ethLock.token}`,
      );
    }
    if (BigInt(record.amount) > BigInt(ethLock.amount)) {
      return new SigError(
        SigErrorCode.InvalidRecord,
        `invalid mint amount ${record.amount}, greater than lock amount ${ethLock.amount}`,
      );
    }
  }
  return SigErrorOk;
}

async function verifyEthForUnlockRecords(records: unlockRecord[]): Promise<SigError> {
  const ids = records.map((record) => record.id);
  const ethBurns = await SigServer.ethDb.getEthBurnsByUniqueIds(ids);
  const ethBurnMap: { [k: string]: EthBurn } = Object.fromEntries(
    ethBurns.map((ethBurn) => [ethBurn.burnTxHash, ethBurn]),
  );

  for (const record of records) {
    const id = record.id;
    if (!id || id.indexOf('-') < 0) {
      return new SigError(SigErrorCode.InvalidRecord, `some burnId invalid :${id}`);
    }
    const burnHashSeparatorIndex = id.indexOf('-');
    const burnTxHash = id.substring(0, burnHashSeparatorIndex);
    if (burnTxHash !== record.burnTxHash) {
      return new SigError(
        SigErrorCode.InvalidRecord,
        `unequal burnTxHash id: ${record.id}, ${burnTxHash} !== ${record.burnTxHash}`,
      );
    }
    const ethBurn = ethBurnMap[burnTxHash];
    if (!ethBurn) {
      return new SigError(SigErrorCode.TxNotFound, `cannot found ethereum burn tx by txHash: ${burnTxHash}, id: ${id}`);
    }
    if (ethBurn.confirmStatus !== 'confirmed') {
      return new SigError(SigErrorCode.TxUnconfirmed, `ethereumForUnlockTx:${ethBurn.burnTxHash} doesn't confirmed`);
    }
    if (record.recipientAddress !== ethBurn.recipient) {
      return new SigError(
        SigErrorCode.InvalidRecord,
        `recipientAddress: ${record.recipientAddress} !== recipient: ${ethBurn.recipient}`,
      );
    }
    if (record.assetIdent !== ethBurn.nervosAssetId) {
      return new SigError(
        SigErrorCode.InvalidRecord,
        `ethereumForUnlockTxHash:${ethBurn.burnTxHash} assetIdent:${record.assetIdent} != ${ethBurn.nervosAssetId}`,
      );
    }
    if (BigInt(record.amount) > BigInt(ethBurn.amount)) {
      return new SigError(
        SigErrorCode.InvalidRecord,
        `invalid unlock amount ${record.amount}, greater than lock amount ${ethBurn.amount}`,
      );
    }
  }
  return SigErrorOk;
}

async function verifyEthMintTx(mintRecord: mintRecord, output: Cell): Promise<SigError> {
  const ownerTypeHash = getOwnerTypeHash();
  const amount = new Amount(mintRecord.amount, 0);
  const asset = new EthAsset(mintRecord.asset, ownerTypeHash);
  const recipientLockscript = parseAddress(mintRecord.recipientLockscript);
  const bridgeCellLockscript = {
    codeHash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
    hashType: ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
    args: asset.toBridgeLockscriptArgs(),
  };

  const lockScript = output.cell_output.lock;
  if (lockScript.code_hash !== recipientLockscript.code_hash) {
    return new SigError(
      SigErrorCode.InvalidRecord,
      `lockScript code_hash:${lockScript.code_hash} doesn't match with:${recipientLockscript.code_hash}`,
    );
  }
  if (lockScript.hash_type !== recipientLockscript.hash_type) {
    return new SigError(
      SigErrorCode.InvalidRecord,
      `lockScript hash_type:${lockScript.hash_type} doesn't match with:${recipientLockscript.hash_type}`,
    );
  }
  if (lockScript.args !== recipientLockscript.args) {
    return new SigError(
      SigErrorCode.InvalidRecord,
      `lockScript args:${lockScript.args} doesn't match with:${recipientLockscript.args}`,
    );
  }

  const typeScript = nonNullable(output.cell_output.type);
  if (typeScript.code_hash !== ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash) {
    return new SigError(
      SigErrorCode.InvalidRecord,
      `typescript code_hash:${typeScript.code_hash} doesn't match with:${ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash}`,
    );
  }
  if (typeScript.hash_type !== ForceBridgeCore.config.ckb.deps.sudtType.script.hashType) {
    return new SigError(
      SigErrorCode.InvalidRecord,
      `typescript hash_type:${typeScript.hash_type} doesn't match with:${ForceBridgeCore.config.ckb.deps.sudtType.script.hashType}`,
    );
  }
  const sudtArgs = ForceBridgeCore.ckb.utils.scriptToHash(<CKBComponents.Script>bridgeCellLockscript);
  if (sudtArgs !== typeScript.args) {
    return new SigError(SigErrorCode.InvalidRecord, `typescript args:${typeScript.args} doesn't with ${sudtArgs}`);
  }

  const data = amount.toUInt128LE();
  if (data !== output.data) {
    return new SigError(SigErrorCode.InvalidRecord, `data:${output.data} doesn't with ${data}`);
  }
  return SigErrorOk;
}

async function verifyEthForUnlockTx(unlockRecord: unlockRecord, output: Cell): Promise<SigError> {
  const lockScript = output.cell_output.lock;
  const recipientLockscript = parseAddress(unlockRecord.recipientAddress);
  if (lockScript.code_hash !== recipientLockscript.code_hash) {
    return new SigError(
      SigErrorCode.InvalidRecord,
      `lockScript code_hash:${lockScript.code_hash} doesn't match with:${recipientLockscript.code_hash}`,
    );
  }
  if (lockScript.hash_type !== recipientLockscript.hash_type) {
    return new SigError(
      SigErrorCode.InvalidRecord,
      `lockScript hash_type:${lockScript.hash_type} doesn't match with:${recipientLockscript.hash_type}`,
    );
  }
  if (lockScript.args !== recipientLockscript.args) {
    return new SigError(
      SigErrorCode.InvalidRecord,
      `lockScript args:${lockScript.args} doesn't match with:${recipientLockscript.args}`,
    );
  }

  const typeScript = output.cell_output.type;
  const sudtTypescript = ForceBridgeCore.config.ckb.deps.sudtType.script;
  if (typeScript) {
    // verify sudt typescriptHash
    const typescriptHash = ForceBridgeCore.ckb.utils.scriptToHash({
      codeHash: typeScript.code_hash,
      hashType: typeScript.hash_type,
      args: typeScript.args,
    });
    if (typescriptHash !== unlockRecord.assetIdent) {
      return new SigError(
        SigErrorCode.InvalidRecord,
        `typescript hash_type:${typeScript.hash_type} doesn't match with:${sudtTypescript.hashType}`,
      );
    }
    const data = utils.toBigUInt128LE(BigInt(unlockRecord.amount));
    if (data !== output.data) {
      return new SigError(SigErrorCode.InvalidRecord, `data:${output.data} doesn't with ${data}`);
    }
  } else {
    // verify ckb typescriptHash
    if ('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' !== unlockRecord.assetIdent) {
      return new SigError(
        SigErrorCode.InvalidRecord,
        `typescript hash_type: 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff doesn't match with:${sudtTypescript.hashType}`,
      );
    }
    if (BigInt(unlockRecord.amount) !== BigInt(output.cell_output.capacity)) {
      return new SigError(
        SigErrorCode.InvalidRecord,
        `capacity: ${unlockRecord.amount} doesn't with ${output.cell_output.capacity}`,
      );
    }
  }
  return SigErrorOk;
}

function verifyTxSkeleton(txSkeleton: TransactionSkeletonType, sigType: SigType): SigError {
  let newTxSkeleton = TransactionSkeleton({
    cellProvider: txSkeleton.get('cellProvider'),
    cellDeps: txSkeleton.get('cellDeps'),
    headerDeps: txSkeleton.get('headerDeps'),
    inputs: txSkeleton.get('inputs'),
    outputs: txSkeleton.get('outputs'),
    witnesses: txSkeleton.get('witnesses'),
    fixedEntries: txSkeleton.get('fixedEntries'),
    inputSinces: txSkeleton.get('inputSinces'),
  });
  if (sigType === 'unlock') {
    // Lumos not support omni-lock, so we use a tricky way to workaround
    const lumosConfig = getConfig();
    const trickyLumosConfig = {
      PREFIX: lumosConfig.PREFIX,
      SCRIPTS: {
        SECP256K1_BLAKE160_MULTISIG: {
          CODE_HASH: nonNullable(ForceBridgeCore.config.ckb.deps.omniLock?.script.codeHash),
          HASH_TYPE: nonNullable(ForceBridgeCore.config.ckb.deps.omniLock?.script.hashType) as 'type' | 'data',
          TX_HASH: nonNullable(ForceBridgeCore.config.ckb.deps.omniLock?.cellDep.outPoint.txHash),
          INDEX: nonNullable(ForceBridgeCore.config.ckb.deps.omniLock?.cellDep.outPoint.index),
          DEP_TYPE: nonNullable(ForceBridgeCore.config.ckb.deps.omniLock?.cellDep.depType),
        },
        SECP256K1_BLAKE160: lumosConfig.SCRIPTS.SECP256K1_BLAKE160,
      },
    };
    newTxSkeleton = common.prepareSigningEntries(newTxSkeleton, {
      config: trickyLumosConfig,
    });
  } else {
    newTxSkeleton = common.prepareSigningEntries(newTxSkeleton);
  }
  const newSigningEntries = newTxSkeleton.get('signingEntries');

  if (newSigningEntries.size !== txSkeleton.get('signingEntries').size) {
    return new SigError(
      SigErrorCode.InvalidParams,
      `invalid signingEntries size:${txSkeleton.get('signingEntries').size}`,
    );
  }

  txSkeleton.get('signingEntries').forEach((entry, key) => {
    const newEntry = newSigningEntries.get(key)!;
    if (entry.message !== newEntry.message) {
      return new SigError(
        SigErrorCode.InvalidParams,
        `invalid signingEntries message:${entry.message} index:${entry.index}`,
      );
    }
    if (entry.type !== newEntry.type) {
      return new SigError(SigErrorCode.InvalidParams, `invalid signingEntrie type:${entry.type} index:${entry.index}`);
    }
    if (entry.index !== newEntry.index) {
      return new SigError(SigErrorCode.InvalidParams, `invalid signingEntrie index:${entry.index}`);
    }
  });
  return SigErrorOk;
}

export async function signCkbTx(params: collectSignaturesParams): Promise<SigResponse> {
  if (!verifyCollector(params)) {
    return SigResponse.fromSigError(SigErrorCode.InvalidCollector);
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const privKey = SigServer.getKey('ckb', params.requestAddress!);
  if (privKey === undefined) {
    return SigResponse.fromSigError(SigErrorCode.InvalidParams, `cannot found key by address:${params.requestAddress}`);
  }

  const ckbHandler = ForceBridgeCore.getXChainHandler().ckb!;
  if ((await ckbHandler.getTipBlock()).height - ckbHandler.getHandledBlock().height >= 20) {
    return SigResponse.fromSigError(SigErrorCode.BlockSyncUncompleted);
  }

  const signed = await SigServer.signedDb.getSignedByRawData(params.rawData);
  if (signed) {
    return SigResponse.fromData(signed.signature);
  }

  const pubKey = ForceBridgeCore.ckb.utils.privateKeyToPublicKey(privKey);
  const payload = params.payload as ckbCollectSignaturesPayload;
  const txSkeleton = objectToTransactionSkeleton(payload.txSkeleton);
  let err: SigError = verifyTxSkeleton(txSkeleton, payload.sigType);
  if (err.Code !== SigErrorCode.Ok) {
    return new SigResponse(err);
  }

  let message: string;
  switch (payload.sigType) {
    case 'mint':
      err = await verifyMintTx(pubKey, params.rawData, payload as ckbMintCollectSignaturesPayload);
      if (err.Code !== SigErrorCode.Ok) {
        return new SigResponse(err);
      }
      message = txSkeleton.signingEntries.get(1)!.message;
      break;
    case 'create_cell':
      err = await verifyCreateCellTx(params.rawData, payload as ckbCreateCellCollectSignaturesPayload);
      if (err.Code !== SigErrorCode.Ok) {
        return new SigResponse(err);
      }
      message = txSkeleton.signingEntries.get(1)!.message;
      break;
    case 'unlock':
      err = await verifyUnlockTx(pubKey, params.rawData, payload as ckbUnlockCollectSignaturesPayload);
      if (err.Code !== SigErrorCode.Ok) {
        return new SigResponse(err);
      }
      message = txSkeleton.signingEntries.filter((v) => v.index === 0).get(0)!.message;
      break;
    default:
      return SigResponse.fromSigError(SigErrorCode.InvalidParams, `invalid sigType:${payload.sigType}`);
  }

  const sig = key.signRecoverable(message, privKey).slice(2);

  if (payload.sigType === 'mint') {
    const payload = params.payload as ckbMintCollectSignaturesPayload;
    asserts(payload.mintRecords);

    await SigServer.signedDb.createSigned(
      payload.mintRecords.map((mintRecord) => {
        return {
          sigType: 'mint',
          chain: mintRecord.chain,
          amount: mintRecord.amount,
          receiver: mintRecord.recipientLockscript,
          asset: mintRecord.asset,
          refTxHash: mintRecord.id,
          pubKey: pubKey,
          rawData: params.rawData,
          inputOutPoints: txSkeleton.inputs
            .map((cell) => {
              return cell.out_point!.tx_hash + ':' + cell.out_point!.index;
            })
            .join(';'),
          signature: sig,
        };
      }),
    );
    await SigServer.setPendingTx('ckb', params);
  } else if (payload.sigType === 'unlock') {
    const payload = params.payload as ckbUnlockCollectSignaturesPayload;
    asserts(payload.unlockRecords);

    await SigServer.signedDb.createSigned(
      payload.unlockRecords.map((unlockRecord) => {
        return {
          sigType: 'unlock',
          chain: unlockRecord.xchain,
          amount: unlockRecord.amount,
          receiver: unlockRecord.recipientAddress,
          asset: unlockRecord.assetIdent,
          refTxHash: unlockRecord.burnTxHash,
          pubKey: pubKey,
          rawData: params.rawData,
          inputOutPoints: txSkeleton.inputs
            .map((cell) => {
              return cell.out_point!.tx_hash + ':' + cell.out_point!.index;
            })
            .join(';'),
          signature: sig,
        };
      }),
    );
    await SigServer.setPendingTx('ckb', params);
  }
  return SigResponse.fromData(sig);
}
