import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { EthDb } from '@force-bridge/x/dist/db';
import { IEthMint } from '@force-bridge/x/dist/db/model';
import { SignedDb } from '@force-bridge/x/dist/db/signed';
import { collectSignaturesParams } from '@force-bridge/x/dist/multisig/multisig-mgr';
import { EthMintRecord } from '@force-bridge/x/dist/xchain/eth';
import Safe, { EthersAdapter } from '@gnosis.pm/safe-core-sdk';
import { SafeSignature, SafeTransaction } from '@gnosis.pm/safe-core-sdk-types';
import ethers from 'ethers';
import { ethMintCollectSignaturesPayload } from '../../x/dist/multisig/multisig-mgr';
import { SigError, SigErrorCode, SigErrorOk } from '../src/error';
import { SigResponse } from './response';

class EthMint {
  protected ethDb: EthDb;
  protected signedDb: SignedDb;
  protected keys: Map<string, string>;
  constructor(ethDb: EthDb, signedDb: SignedDb, keys: Map<string, string>) {
    this.ethDb = ethDb;
    this.signedDb = signedDb;
    this.keys = keys;
  }

  async request(params: collectSignaturesParams): Promise<SigResponse<SafeSignature>> {
    const privateKey = this.keys['eth'][params.requestAddress];
    if (privateKey === undefined) {
      return SigResponse.fromSigError(
        SigErrorCode.InvalidParams,
        `cannot found key by address:${params.requestAddress}`,
      );
    }

    if (await ForceBridgeCore.getXChainHandler().eth!.checkBlockSync!()) {
      return SigResponse.fromSigError(SigErrorCode.BlockSyncUncompleted);
    }

    const signed = await this.signedDb.getSignedByRawData(params.rawData);
    if (signed) {
      return SigResponse.fromData(JSON.parse(signed.signature) as SafeSignature);
    }

    const payload = params.payload as ethMintCollectSignaturesPayload;

    const signature = await this.sign(payload.tx, privateKey);

    return SigResponse.fromData(signature);
  }

  async sign(tx: SafeTransaction, privateKey: string): Promise<SafeSignature> {
    const safe = await Safe.create({
      ethAdapter: new EthersAdapter({
        ethers,
        signer: new ethers.Wallet(privateKey),
      }),
      safeAddress: ForceBridgeCore.config.eth.safeMultisignContractAddress,
    });

    return await safe.signTransactionHash(await safe.getTransactionHash(tx));
  }

  async verifyDuplicated(records: EthMintRecord[]): Promise<boolean> {
    const hashes = records.map((r) => r.lockId);

    return !(await this.ethDb.hasOneMinted(hashes));
  }

  async verifyRecord(records: EthMintRecord[]): Promise<SigError> {
    const hashes = records.map((r) => r.lockId);

    const needToMinted = await this.ethDb.ethToBeMintedByCkbTx(hashes);

    const mapped = new Map<string, IEthMint>();
    needToMinted.forEach((r) => {
      mapped.set(r.ckbTxHash, r);
    });

    for (const record of records) {
      const mint = mapped.get(record.lockId);
      if (!mint) {
        return new SigError(SigErrorCode.TxNotFound, `cannot found ckbLock record by ckbTxHash:${record.lockId}`);
      }

      if (mint.nervosAssetId != record.assetId) {
        return new SigError(
          SigErrorCode.InvalidRecord,
          `lockTx:${record.lockId} asset:${record.assetId} != ${mint.nervosAssetId}`,
        );
      }

      if (BigInt(record.amount) > BigInt(mint.amount)) {
        return new SigError(
          SigErrorCode.InvalidRecord,
          `invalid lock amount: ${record.amount}, greater than mint amount: ${mint.amount}`,
        );
      }

      if (mint.recipientAddress !== record.to) {
        return new SigError(
          SigErrorCode.InvalidRecord,
          `burnTx:${record.lockId} recipientAddress:${record.to} != ${mint.recipientAddress}`,
        );
      }
    }
    return SigErrorOk;
  }
}

export default EthMint;
