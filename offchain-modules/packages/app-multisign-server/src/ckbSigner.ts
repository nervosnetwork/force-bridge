import { Cell } from '@ckb-lumos/base';
import { key } from '@ckb-lumos/hd';
import { parseAddress } from '@ckb-lumos/helpers';
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
import { Address, AddressType, Amount } from '@lay2/pw-core';
import { BigNumber } from 'ethers';
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

async function verifyDuplicateMintTx(pubKey: string, mintRecords: mintRecord[], sigData: string): Promise<SigError> {
  const mintTxHashes = mintRecords.map((mintRecord) => {
    return mintRecord.id;
  });
  const signedTxHashes = await SigServer.signedDb.getDistinctSignedTxByRefTxHashes(pubKey, mintTxHashes);
  asserts(signedTxHashes);

  if (signedTxHashes.length === 0) {
    return SigErrorOk;
  }

  if (
    !signedTxHashes.some((signedTxHash) => {
      return signedTxHash != sigData;
    })
  ) {
    return SigErrorOk;
  }

  //TODO check whether signedTx failed
  return new SigError(SigErrorCode.DuplicateSign, `duplicate mint tx in ${mintTxHashes.join(',')}`);
}

async function verifyMintTx(pubKey: string, rawData: string, payload: ckbCollectSignaturesPayload): Promise<SigError> {
  const txSkeleton = payload.txSkeleton;
  const sigData = txSkeleton.signingEntries[1].message;
  if (rawData !== sigData) {
    return new SigError(SigErrorCode.InvalidParams, `rawData:${rawData} doesn't match with:${sigData}`);
  }
  const mintRecords = payload.mintRecords;
  asserts(mintRecords);

  let err = await verifyDuplicateMintTx(pubKey, mintRecords, sigData);
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
  const mintTxHashes = records.map((record) => {
    return record.id;
  });
  const ethLocks = await SigServer.ethDb.getEthLocksByTxHashes(mintTxHashes);
  const ethLockMap = new Map<string, EthLock>();
  ethLocks.forEach((record) => {
    return ethLockMap.set(record.txHash, record);
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
    const asset = new EthAsset(record.asset);
    if (!asset.inWhiteList()) {
      return new SigError(SigErrorCode.InvalidRecord, `asset not in white list: assetAddress:${record.asset}`);
    }
    if (BigNumber.from(ethLock.amount).lt(BigNumber.from(asset.getMinimalAmount()))) {
      return new SigError(SigErrorCode.InvalidRecord, `lock amount less than minimal: burn amount ${ethLock.amount}`);
    }
    if (!verifyEthBridgeFee(asset, record.amount, ethLock.amount)) {
      return new SigError(
        SigErrorCode.InvalidRecord,
        `invalid bridge fee: ethLockTxHash:${record.id}, lock amount:${ethLock.amount}, mint amount:${record.amount}`,
      );
    }
  }
  return SigErrorOk;
}

function verifyEthBridgeFee(asset: EthAsset, mintAmount: string, lockAmount: string): boolean {
  const bridgeFee = BigNumber.from(lockAmount).sub(BigNumber.from(mintAmount));
  const expectedBridgeFee = BigNumber.from(asset.getBridgeFee('in'));
  return bridgeFee.gte(expectedBridgeFee.div(4)) && bridgeFee.lte(expectedBridgeFee.mul(4));
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

export async function signCkbTx(params: collectSignaturesParams): Promise<SigResponse> {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const privKey = SigServer.getKey('ckb', params.requestAddress!);
  if (privKey === undefined) {
    return SigResponse.fromSigError(SigErrorCode.InvalidParams, `cannot found key by address:${params.requestAddress}`);
  }
  const pubKey = ForceBridgeCore.ckb.utils.privateKeyToPublicKey(privKey);

  const payload = params.payload as ckbCollectSignaturesPayload;
  const txSkeleton = payload.txSkeleton;
  let err: SigError;
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

  const message = txSkeleton.signingEntries[1].message;
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
          txHash: params.rawData,
          pubKey: pubKey,
          rawData: params.rawData,
          signature: sig,
        };
      }),
    );
  }
  return SigResponse.fromData(sig);
}
