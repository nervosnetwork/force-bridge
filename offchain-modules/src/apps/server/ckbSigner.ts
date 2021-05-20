import { key } from '@ckb-lumos/hd';
import { ckbCollectSignaturesPayload, collectSignaturesParams, mintRecord } from '@force-bridge/multisig/multisig-mgr';
import { BtcAsset, ChainType, EosAsset, EthAsset, TronAsset } from '@force-bridge/ckb/model/asset';
import { lockTopic } from '@force-bridge/xchain/eth';
import { fromHexString, uint8ArrayToString } from '@force-bridge/utils';
import { Address, AddressType, Amount } from '@lay2/pw-core';
import { Cell } from '@ckb-lumos/base';
import { ForceBridgeCore } from '@force-bridge/core';
import { SigServer } from './sigServer';

async function verifyCreateCellTx(rawData: string, payload: ckbCollectSignaturesPayload): Promise<Error> {
  const txSkeleton = payload.txSkeleton;
  const sigData = txSkeleton.signingEntries[1].message;
  if (rawData !== sigData) {
    return new Error(`rawData:${rawData} doesn't match with:${sigData}`);
  }

  const createAssets = payload.createAssets;
  const ownLockHash = SigServer.getOwnLockHash();
  let bridgeCells = [];
  txSkeleton.outputs.forEach((output) => {
    if (!output.cell_output.lock) {
      return;
    }
    if (output.cell_output.lock.code_hash === ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash) {
      bridgeCells.push(output);
    }
  });
  if (bridgeCells.length !== createAssets.length) {
    return new Error(`create bridge recode length:${bridgeCells.length} doesn't match with:${createAssets.length}`);
  }
  for (let i = 0; i < createAssets.length; i++) {
    const createAsset = createAssets[i];
    let asset;
    switch (createAsset.chain) {
      case ChainType.BTC:
        asset = new BtcAsset(createAsset.asset, ownLockHash);
        break;
      case ChainType.ETH:
        asset = new EthAsset(createAsset.asset, ownLockHash);
        break;
      case ChainType.TRON:
        asset = new TronAsset(createAsset.asset, ownLockHash);
        break;
      case ChainType.EOS:
        asset = new EosAsset(createAsset.asset, ownLockHash);
        break;
      default:
        return Promise.reject(new Error(`chain type:${createAsset.chain} doesn't support`));
    }

    const output = bridgeCells[i];
    const lockScript = output.cell_output.lock;
    if (output.data !== '0x') {
      return new Error(
        `create bridge cell data:${output.data} doesn't match with 0x, asset chain:${createAsset.chain} address:${createAsset.asset}`,
      );
    }
    if (lockScript.args !== asset.toBridgeLockscriptArgs()) {
      return new Error(
        `create bridge cell lockScript args:${
          lockScript.args
        } doesn't match with ${asset.toBridgeLockscriptArgs()}, asset chain:${createAsset.chain} address:${
          createAsset.asset
        }`,
      );
    }
    if (lockScript.hash_type !== ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType) {
      return new Error(
        `create bridge cell lockScript hash_type:${lockScript.hash_type} doesn't match with ${ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType}, asset chain:${createAsset.chain} address:${createAsset.asset}`,
      );
    }
  }
  return undefined;
}

async function verifyMintTx(rawData: string, payload: ckbCollectSignaturesPayload): Promise<Error> {
  const txSkeleton = payload.txSkeleton;
  const sigData = txSkeleton.signingEntries[1].message;
  if (rawData !== sigData) {
    return new Error(`rawData:${rawData} doesn't match with:${sigData}`);
  }
  const mintRecords = payload.mintRecords;

  // const mintTxHashes = mintRecords.map((mintRecord) => {
  //   return mintRecord.id;
  // });

  // const signedTxs = await signedDb.getSignedByRefTxHashes(mintTxHashes);
  // if (signedTxs.length != 0) {
  //   return new Error(`refTxHashes:${mintTxHashes.join(',')} had already signed`);
  // }

  let mintCells = [];
  txSkeleton.outputs.forEach((output) => {
    if (!output.cell_output.type) {
      return;
    }
    if (output.cell_output.type.code_hash === ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash) {
      mintCells.push(output);
    }
  });

  if (mintRecords.length !== mintCells.length) {
    return new Error(`mint recode length:${mintRecords.length} doesn't match with:${mintCells.length}`);
  }

  let err: Error;
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
    err = await verifyEthMintRecord(mintRecord);
    if (err) {
      return err;
    }
    const output = mintCells[i];
    err = await verifyEthMintTx(mintRecord, output);
    if (err) {
      return err;
    }
  }
  return undefined;
}

async function verifyEthMintRecord(record: mintRecord): Promise<Error> {
  let success = false;
  const txReceipt = await SigServer.ethProvider.getTransactionReceipt(record.id);
  for (const log of txReceipt.logs) {
    if (log.address !== ForceBridgeCore.config.eth.contractAddress) {
      continue;
    }
    const parsedLog = SigServer.ethInterface.parseLog(log);
    if (parsedLog.topic !== lockTopic) {
      continue;
    }
    const amount = parsedLog.args.lockedAmount.toString();
    if (amount !== record.amount) {
      return Promise.reject(new Error(`mint amount:${record.amount} doesn't match with ${amount}`));
    }
    const asset = parsedLog.args.token;
    if (asset !== record.asset) {
      return Promise.reject(new Error(`mint asset:${record.asset} doesn't match with ${asset}`));
    }
    const recipientLockscript = uint8ArrayToString(fromHexString(parsedLog.args.recipientLockscript));
    if (recipientLockscript !== record.recipientLockscript) {
      return Promise.reject(
        new Error(`mint asset:${record.recipientLockscript} doesn't match with ${recipientLockscript}`),
      );
    }
    success = true;
    break;
  }
  if (!success) {
    return Promise.reject(new Error(`cannot found validate log`));
  }
  return undefined;
}

async function verifyEthMintTx(mintRecord: mintRecord, output: Cell): Promise<Error> {
  const ownLockHash = SigServer.getOwnLockHash();
  const recipient = new Address(mintRecord.recipientLockscript, AddressType.ckb);
  const amount = new Amount(mintRecord.amount, 0);
  const asset = new EthAsset(mintRecord.asset, ownLockHash);
  const recipientLockscript = recipient.toLockScript();
  const bridgeCellLockscript = {
    codeHash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
    hashType: ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
    args: asset.toBridgeLockscriptArgs(),
  };

  const lockScript = output.cell_output.lock;
  if (lockScript.code_hash !== recipientLockscript.codeHash) {
    return new Error(`lockScript code_hash:${lockScript.code_hash} doesn't match with:${recipientLockscript.codeHash}`);
  }
  if (lockScript.hash_type !== recipientLockscript.hashType) {
    return new Error(`lockScript hash_type:${lockScript.hash_type} doesn't match with:${recipientLockscript.hashType}`);
  }
  if (lockScript.args !== recipientLockscript.args) {
    return new Error(`lockScript args:${lockScript.args} doesn't match with:${recipientLockscript.args}`);
  }

  const typeScript = output.cell_output.type;
  if (typeScript.code_hash !== ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash) {
    return new Error(
      `typescript code_hash:${typeScript.code_hash} doesn't match with:${ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash}`,
    );
  }
  if (typeScript.hash_type !== ForceBridgeCore.config.ckb.deps.sudtType.script.hashType) {
    return new Error(
      `typescript hash_type:${typeScript.hash_type} doesn't match with:${ForceBridgeCore.config.ckb.deps.sudtType.script.hashType}`,
    );
  }
  const sudtArgs = ForceBridgeCore.ckb.utils.scriptToHash(<CKBComponents.Script>bridgeCellLockscript);
  if (sudtArgs !== typeScript.args) {
    return new Error(`typescript args:${typeScript.args} doesn't with ${sudtArgs}`);
  }

  const data = amount.toUInt128LE();
  if (data !== output.data) {
    return new Error(`data:${output.data} doesn't with ${data}`);
  }
  return undefined;
}

export async function signCkbTx(params: collectSignaturesParams): Promise<string> {
  const payload = params.payload as ckbCollectSignaturesPayload;
  const txSkeleton = payload.txSkeleton;
  let err: Error;
  switch (payload.sigType) {
    case 'mint':
      err = await verifyMintTx(params.rawData, payload);
      if (err) {
        return Promise.reject(err);
      }
      break;
    case 'create_cell':
      err = await verifyCreateCellTx(params.rawData, payload);
      if (err) {
        return Promise.reject(err);
      }
      break;
    default:
      return Promise.reject(new Error(`invalid sigType:${payload.sigType}`));
  }

  const args = require('minimist')(process.argv.slice(2));
  const index = args.index;
  const privKey = ForceBridgeCore.config.ckb.keys[index];
  const message = txSkeleton.signingEntries[1].message;
  const sig = key.signRecoverable(message, privKey).slice(2);

  // if (payload.sigType === 'mint'){
  //   await signedDb.createSigned(
  //       payload.mintRecords.map((mintRecord) => {
  //         return {
  //           sigType: '',
  //           chain: mintRecord.chain,
  //           amount: mintRecord.amount,
  //           asset: mintRecord.asset,
  //           refTxHash: mintRecord.id,
  //           txHash: '',
  //           signature: sig,
  //           rawData: params.rawData
  //         };
  //       }),
  //   );
  // }
  return sig;
}
