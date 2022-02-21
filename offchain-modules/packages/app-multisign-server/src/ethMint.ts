import { ChainType } from '@force-bridge/x/dist/ckb/model/asset';
import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { CkbDb, EthDb } from '@force-bridge/x/dist/db';
import { SignedDb } from '@force-bridge/x/dist/db/signed';
import { collectSignaturesParams } from '@force-bridge/x/dist/multisig/multisig-mgr';
import { verifyCollector } from '@force-bridge/x/dist/multisig/utils';
import { privateKeyToEthAddress } from '@force-bridge/x/dist/utils';
import { EthMintRecord } from '@force-bridge/x/dist/xchain/eth';
import Safe, { EthersAdapter } from '@gnosis.pm/safe-core-sdk';
import { SafeSignature, SafeTransaction } from '@gnosis.pm/safe-core-sdk-types';
import { ethers } from 'ethers';
import { ethMintCollectSignaturesPayload } from '../../x/dist/multisig/multisig-mgr';
import { SigError, SigErrorCode } from '../src/error';
import { SigResponse } from './response';
import { SigServer } from './sigServer';

class EthMint {
  protected ethDb: EthDb;
  protected signedDb: SignedDb;
  protected ckbDb: CkbDb;
  protected keys: Map<string, string>;
  constructor(ethDb: EthDb, ckbDb: CkbDb, signedDb: SignedDb, keys: Map<string, string>) {
    this.ethDb = ethDb;
    this.ckbDb = ckbDb;
    this.signedDb = signedDb;
    this.keys = keys;
  }

  async request(params: collectSignaturesParams): Promise<SigResponse<SafeSignature>> {
    const privateKey = this.keys[params.requestAddress!];
    if (privateKey === undefined) {
      return SigResponse.fromSigError(
        SigErrorCode.InvalidParams,
        `cannot found key by address:${params.requestAddress}`,
      );
    }

    if (!verifyCollector(params)) {
      return SigResponse.fromSigError(SigErrorCode.InvalidCollector);
    }

    if (await ForceBridgeCore.getXChainHandler().eth!.checkBlockSync!()) {
      return SigResponse.fromSigError(SigErrorCode.BlockSyncUncompleted);
    }

    const payload = params.payload as ethMintCollectSignaturesPayload;

    try {
      await this.verifyRecord(payload.mintRecords);
    } catch (e) {
      return new SigResponse(e as SigError);
    }

    if (!(await this.verifyDuplicated(payload.mintRecords))) {
      return SigResponse.fromSigError(SigErrorCode.TxCompleted);
    }

    const signature = await this.sign(payload.tx, privateKey);

    await this.signedDb.createSigned(
      payload.mintRecords.map((record) => {
        return {
          sigType: 'mint',
          chain: ChainType.ETH,
          amount: ethers.BigNumber.from(record.amount).toString(),
          receiver: record.to,
          asset: record.assetId,
          refTxHash: record.lockId,
          nonce: 0,
          rawData: params.rawData,
          pubKey: privateKeyToEthAddress(privateKey),
          signature: JSON.stringify(signature),
        };
      }),
    );

    return SigResponse.fromData(signature);
  }

  async sign(tx: SafeTransaction, privateKey: string): Promise<SafeSignature> {
    const safe = await Safe.create({
      ethAdapter: new EthersAdapter({
        ethers,
        signer: new ethers.Wallet(privateKey, SigServer.ethProvider),
      }),
      safeAddress: ForceBridgeCore.config.eth.safeMultisignContractAddress,
      contractNetworks: ForceBridgeCore.config.eth.safeMultisignContractNetworks,
    });

    return await safe.signTransactionHash(await safe.getTransactionHash(tx));
  }

  async verifyDuplicated(records: EthMintRecord[]): Promise<boolean> {
    const hashes = records.map((r) => r.lockId);

    return !(await this.ethDb.hasOneMinted(hashes));
  }

  async verifyRecord(records: EthMintRecord[]): Promise<void> {
    const hashes = records.map((r) => r.lockId);

    const needToMinted = await this.ckbDb.ckbLockedByTxHashes(hashes);

    const mapped = new Map<string, { nervosAssetId: string; amount: string; recipientAddress: string }>();
    needToMinted.forEach((r) => {
      mapped.set(r.ckbTxHash, {
        nervosAssetId: r.assetIdent,
        amount: r.amount,
        recipientAddress: r.recipientAddress,
      });
    });

    for (const record of records) {
      const mint = mapped.get(record.lockId);
      if (!mint) {
        throw new SigError(SigErrorCode.TxNotFound, `cannot found ckbLock record by ckbTxHash:${record.lockId}`);
      }

      if (mint.nervosAssetId != record.assetId) {
        throw new SigError(
          SigErrorCode.InvalidRecord,
          `lockTx:${record.lockId} asset:${record.assetId} != ${mint.nervosAssetId}`,
        );
      }

      if (BigInt(record.amount) > BigInt(mint.amount)) {
        throw new SigError(
          SigErrorCode.InvalidRecord,
          `invalid lock amount: ${record.amount}, greater than mint amount: ${mint.amount}`,
        );
      }

      if (mint.recipientAddress !== record.to) {
        throw new SigError(
          SigErrorCode.InvalidRecord,
          `burnTx:${record.lockId} recipientAddress:${record.to} != ${mint.recipientAddress}`,
        );
      }
    }
  }
}

export default EthMint;
