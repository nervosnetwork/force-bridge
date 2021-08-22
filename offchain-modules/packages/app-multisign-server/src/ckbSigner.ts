import { Cell } from '@ckb-lumos/base';
import { common } from '@ckb-lumos/common-scripts';
import { key } from '@ckb-lumos/hd';
import {
  parseAddress,
  objectToTransactionSkeleton,
  TransactionSkeleton,
  TransactionSkeletonType,
  TransactionSkeletonObject,
} from '@ckb-lumos/helpers';
import { BtcAsset, ChainType, EosAsset, EthAsset, TronAsset } from '@force-bridge/x/dist/ckb/model/asset';
import { getOwnerTypeHash } from '@force-bridge/x/dist/ckb/tx-helper/multisig/multisig_helper';
import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { EthLock } from '@force-bridge/x/dist/db/entity/EthLock';
import { asserts, nonNullable } from '@force-bridge/x/dist/errors';
import {
  ckbCollectSignaturesPayload,
  collectSignaturesParams,
  mintRecord,
} from '@force-bridge/x/dist/multisig/multisig-mgr';
import { verifyCollector } from '@force-bridge/x/dist/multisig/utils';
import { Amount } from '@lay2/pw-core';
import { SigError, SigErrorCode, SigErrorOk } from './error';
import { SigResponse, SigServer } from './sigServer';

async function verifyCreateCellTx(rawData: string, payload: ckbCollectSignaturesPayload): Promise<SigError> {
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
  txSkeleton: TransactionSkeletonObject,
): Promise<SigError> {
  const refTxHashes = mintRecords.map((mintRecord) => {
    return mintRecord.id;
  });

  const mints = await SigServer.ckbDb.getCkbMintByIds(refTxHashes);
  if (mints.length !== 0) {
    return new SigError(SigErrorCode.TxCompleted);
  }

  const signedRecords = await SigServer.signedDb.getSignedByRefTxHashes(pubKey, refTxHashes);
  asserts(signedRecords);

  const sigData = txSkeleton.signingEntries[1].message;
  if (
    signedRecords.some((signedTx) => {
      if (signedTx.rawData === sigData) {
        return false;
      }
      const inputOutPoints = signedTx.inputOutPoints;
      if (!inputOutPoints || inputOutPoints.length === 0) {
        return true;
      }
      const inputCellMap = new Map<string, string>();
      inputOutPoints.split(';').forEach((output) => {
        const point = output.split(':');
        if (point.length !== 2) {
          return;
        }
        inputCellMap.set(point[0], point[1]);
      });

      let overlap = false;
      for (const cell of txSkeleton.inputs) {
        const index = inputCellMap.get(cell.out_point!.tx_hash);
        if (index && index === cell.out_point!.index) {
          overlap = true;
          break;
        }
      }
      return !overlap;
    })
  ) {
    return new SigError(SigErrorCode.DuplicateSign, `duplicate mint tx in ${refTxHashes.join(',')}`);
  }

  return SigErrorOk;
}

async function verifyMintTx(pubKey: string, rawData: string, payload: ckbCollectSignaturesPayload): Promise<SigError> {
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
    if (record.recipientLockscript != ethLock.recipient) {
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

function verifyTxSkeleton(txSkeleton: TransactionSkeletonType): SigError {
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
  newTxSkeleton = common.prepareSigningEntries(newTxSkeleton);
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
  let err: SigError = verifyTxSkeleton(txSkeleton);
  if (err.Code !== SigErrorCode.Ok) {
    return new SigResponse(err);
  }

  switch (payload.sigType) {
    case 'mint':
      err = await verifyMintTx(pubKey, params.rawData, payload);
      if (err.Code !== SigErrorCode.Ok) {
        return new SigResponse(err);
      }
      break;
    case 'create_cell':
      err = await verifyCreateCellTx(params.rawData, payload);
      if (err.Code !== SigErrorCode.Ok) {
        return new SigResponse(err);
      }
      break;
    default:
      return SigResponse.fromSigError(SigErrorCode.InvalidParams, `invalid sigType:${payload.sigType}`);
  }

  const message = txSkeleton.signingEntries.get(1)!.message;
  const sig = key.signRecoverable(message, privKey).slice(2);

  if (payload.sigType === 'mint') {
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
  }
  return SigResponse.fromData(sig);
}
