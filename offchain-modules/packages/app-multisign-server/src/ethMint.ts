import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { EthDb } from '@force-bridge/x/dist/db';
import { SignedDb } from '@force-bridge/x/dist/db/signed';
import { collectSignaturesParams, ethMintCollectSignaturesPayload } from '@force-bridge/x/dist/multisig/multisig-mgr';
import Safe, { EthersAdapter } from '@gnosis.pm/safe-core-sdk';
import { SafeSignature, SafeTransaction } from '@gnosis.pm/safe-core-sdk-types';
import { ethers } from 'ethers';
import { SigErrorCode } from './error';
import { SigResponse } from './response';
import { SigServer } from './sigServer';

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
    const privateKey = this.keys[params.requestAddress!];
    if (privateKey === undefined) {
      return SigResponse.fromSigError(
        SigErrorCode.InvalidParams,
        `cannot found key by address:${params.requestAddress}`,
      );
    }

    if (await ForceBridgeCore.getXChainHandler().eth!.checkBlockSync!()) {
      return SigResponse.fromSigError(SigErrorCode.BlockSyncUncompleted);
    }

    const payload = params.payload as ethMintCollectSignaturesPayload;

    const signature = await this.sign(payload.tx, privateKey);

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
}

export default EthMint;
