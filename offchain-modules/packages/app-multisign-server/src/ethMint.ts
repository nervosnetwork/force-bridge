import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { IEthMint } from '@force-bridge/x/dist/db/model';
import { collectSignaturesParams } from '@force-bridge/x/dist/multisig/multisig-mgr';
import { EthMintRecord } from '@force-bridge/x/dist/xchain/eth';
import Safe, { EthersAdapter } from '@gnosis.pm/safe-core-sdk';
import { SafeSignature, SafeTransaction } from '@gnosis.pm/safe-core-sdk-types';
import ethers from 'ethers';
import { ethMintCollectSignaturesPayload } from '../../x/dist/multisig/multisig-mgr';
import { SigError, SigErrorCode, SigErrorOk } from '../src/error';
import { SigResponse, SigServer } from '../src/sigServer';

class EthMint {
  async request(params: collectSignaturesParams): Promise<SigResponse> {
    const privateKey = SigServer.getKey('eth', params.requestAddress!);
    if (privateKey === undefined) {
      return SigResponse.fromSigError(
        SigErrorCode.InvalidParams,
        `cannot found key by address:${params.requestAddress}`,
      );
    }

    if (await ForceBridgeCore.getXChainHandler().eth!.checkBlockSync!()) {
      return SigResponse.fromSigError(SigErrorCode.BlockSyncUncompleted);
    }

    const signed = await SigServer.signedDb.getSignedByRawData(params.rawData);
    if (signed) {
      return SigResponse.fromData(JSON.parse(signed.signature) as SafeSignature);
    }

    const payload = params.payload as ethMintCollectSignaturesPayload;

    if (!(await this.verifyDuplicated(payload.mintRecords))) {
      return SigResponse.fromSigError(SigErrorCode.TxCompleted);
    }

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

    return !(await SigServer.ethDb.hasOneMinted(hashes));
  }

  async verifyRecord(records: EthMintRecord[]): Promise<SigError> {
    const hashes = records.map((r) => r.lockId);

    const needToMinted = await SigServer.ethDb.ethToBeMintedByCkbTx(hashes);

    const mapped = new Map<string, IEthMint>();
    needToMinted.forEach((r) => {
      mapped.set(r.ckbTxHash, r);
    });

    for (const record of records) {
      const mint = mapped.get(record.lockId);
      if (!mint) {
        return new SigError(SigErrorCode.TxNotFound, `cannot found ckbLock record by ckbTxHash:${record.lockId}`);
      }

      if (mint.asset != record.assetId) {
        return new SigError(
          SigErrorCode.InvalidRecord,
          `lockTx:${record.lockId} asset:${record.assetId} != ${mint.asset}`,
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
