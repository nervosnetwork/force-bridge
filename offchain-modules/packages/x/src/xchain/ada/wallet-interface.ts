import { AdaConfig, forceBridgeRole } from '../../config';
import { ForceBridgeCore } from '../../core';
import { IAdaUnlock } from '../../db/model';
import { MultiSigMgr } from '../../multisig/multisig-mgr';
import { asyncSleep, retryPromise } from '../../utils';
import { logger } from '../../utils/logger';

import * as CardanoWasm from '@emurgo/cardano-serialization-lib-nodejs';
import { WalletServer, ApiTransaction, WalletswalletIdpaymentfeesAmountUnitEnum, ApiPostTransactionFeeData } from 'cardano-wallet-js';
import { mnemonicToEntropy } from 'bip39';
import globalAxios, { AxiosPromise, AxiosInstance } from 'axios';
import { ApiSingleAddressWalletPostData, SingleAddressWalletsApiFactory } from 'cardano-single-address-wallet-client';
import * as utils from './utils';


export class AdaChain {
  public readonly role: forceBridgeRole;
  public readonly config: AdaConfig;
  public readonly multisigMgr: MultiSigMgr;
  public readonly bridgeMultiSigAddr: string;
  public readonly bridgeMultiSigScript: CardanoWasm.NativeScript;
  public readonly policyId: CardanoWasm.ScriptHash;
  public readonly walletServer: WalletServer;
  private walletId: Promise<string>;
  private singleAddressWalletClient: any;

  constructor(role: forceBridgeRole, config) {
    this.role = role;
    this.config = config;
    try {
      var keyHashes: CardanoWasm.Ed25519KeyHash[] = [];
      for (let k of config.multiSignKeyHashes) {
        keyHashes.push(CardanoWasm.Ed25519KeyHash.from_bech32(k));
      }
      this.bridgeMultiSigScript = utils.createMultiSigScript(keyHashes, config.multiSignThreshold);
      this.bridgeMultiSigAddr = utils.getScriptAddress(this.bridgeMultiSigScript, config.networkId).to_address().to_bech32();
      this.policyId = utils.getScriptHash(this.bridgeMultiSigScript);
    } catch (e) {
      logger.error(`AdaChain: could not create bridgeMultiSigScript from multiSignKeyHashes`);
      throw e;
    }
    this.walletServer = WalletServer.init(config.walletRpcUrl);
    if (role === 'collector') {
      this.multisigMgr = new MultiSigMgr('CARDANO', this.config.multiSignHosts, this.config.multiSignThreshold);
    }

    logger.info('AdaChain: bridgeMultiSigAddr:', this.bridgeMultiSigAddr);
    {
      let axiosInstance = globalAxios.create({baseURL: config.walletRpcUrl});
      let configuration = {
        basePath: config.walletRpcUrl
      }
      this.singleAddressWalletClient = SingleAddressWalletsApiFactory(configuration, config.walletRpcUrl, axiosInstance);
    }

    this.walletId = this.createOrRestoreSingleAddressWallet(this.bridgeMultiSigAddr, config.walletName);
  }

  async getTransactions(startTime: string | undefined): Promise<ApiTransaction[]> {
    let walletId = await this.walletId;
    let res = await this.singleAddressWalletClient.listTransactions(walletId, startTime);
    return res.data;
  }

  async getCurrentSlotNumber(): Promise<number> {
    let information = await this.walletServer.getNetworkInformation();
    // @ts-ignore
    return information.network_tip.absolute_slot_number;
  }

  async getAvailableBalance(): Promise<number> {
    let walletId = await this.walletId;
    let res = await this.singleAddressWalletClient.getWallet(walletId);
    return res.data.balance.available.quantity;
  }

  async sendUnlockTxs(records: IAdaUnlock[]): Promise<string | boolean | Error> {
    const maxTryTimes = 30;
    for (let tryTime = 0; ; tryTime++) {
      logger.debug('contract balance', await this.getAvailableBalance());
      try {
        const txBody = await this.buildUnlockTxBody(records);
        const signResult = await this.signUnlockRecords(records, txBody);
        if (typeof signResult === 'boolean' && (signResult as boolean)) {
          return true;
        }
        const signatures = signResult as string[];
        if (signatures.length < ForceBridgeCore.config.ada.multiSignThreshold) {
          return new Error(
            `sig number:${signatures.length} less than multiSignThreshold:${ForceBridgeCore.config.ada.multiSignThreshold}`,
          );
        }

        // make tx with signatures
        const vkeyWitnesses = CardanoWasm.Vkeywitnesses.new();
        for (let sig of signatures) {
          let vkeyWitness = CardanoWasm.Vkeywitness.from_bytes(Buffer.from(sig, 'hex'));
          vkeyWitnesses.add(vkeyWitness);
        }

        const witnesses = CardanoWasm.TransactionWitnessSet.new();
        witnesses.set_vkeys(vkeyWitnesses);
        let scripts = CardanoWasm.NativeScripts.new();
        scripts.add(this.bridgeMultiSigScript);
        witnesses.set_native_scripts(scripts);

        const transaction = CardanoWasm.Transaction.new(
          txBody,
          witnesses,
          undefined, // transaction metadata, TODO: add CkbTxHash
        );

        let signedTx = Buffer.from(transaction.to_bytes()).toString('hex');
        let txId = await this.walletServer.submitTx(signedTx);
        logger.info('successfully sent signed tx', txId);
        return txId
      } catch (e) {
        logger.error(`sendUnlockTxs error, records: ${records}, tryTime: ${tryTime}, error: ${e.stack}`);
        if (tryTime >= maxTryTimes) {
          return e;
        }
        await asyncSleep(15000);
      }
    }
  }

  private async buildUnlockTxBody(
    records: IAdaUnlock[],
  ): Promise<CardanoWasm.TransactionBody> {
    let walletId = await this.walletId;

    // Get coin selection / Tx inputs
    const payments = records.map((record) => {
      let amount = Number(record.amount);
      return {
        address: record.recipientAddress,
        amount: { quantity: amount,
                  unit: WalletswalletIdpaymentfeesAmountUnitEnum.Lovelace
                },
      }
    })
    const body: ApiPostTransactionFeeData = {
      payments: payments,
    };
    const resp = await this.singleAddressWalletClient.coinSelection(body, walletId);
    const coinSelection = resp.data;
    logger.debug("AdaChain: signUnlockRecords: coinSelection", coinSelection)

    // TODO: This should be configurable, and tracked by the verifiers
    const ttl = await this.getCurrentSlotNumber() + 1000;

    return utils.makeTxBody(coinSelection, this.policyId, ttl);
  }

  private async signUnlockRecords(
    records: IAdaUnlock[],
    txBody: CardanoWasm.TransactionBody,
  ): Promise<string[] | boolean> {
    const rawData = Buffer.from(txBody.to_bytes()).toString('hex');

    return await this.multisigMgr.collectSignatures({
      rawData: rawData,
      payload: {
        unlockRecords: records,
      },
    });
  }

  async buildMintTxBody(
    assetName: string,
    quantity: number,
  ): Promise<CardanoWasm.TransactionBody> {
    let walletId = await this.walletId;

    // Assuming the fees would be lesser than 1 Ada
    const oneAda = 1000000;
    // Get coin selection / Tx inputs for paying fees
    const payment = {
      address: this.bridgeMultiSigAddr,
      amount: { quantity: oneAda,
                unit: WalletswalletIdpaymentfeesAmountUnitEnum.Lovelace
              },
    };
    const body: ApiPostTransactionFeeData = {
      payments: [payment],
    };
    const resp = await this.singleAddressWalletClient.coinSelection(body, walletId);
    const coinSelection = resp.data;
    logger.debug("AdaChain: buildMintTxBody: coinSelection", coinSelection)

    const ttl = await this.getCurrentSlotNumber() + 1000;

    // TODO: use cardano-cli to calculate fee, as cardano-wallet does not have mint support
    const fee = 1000;
    return utils.makeMintTxBody(coinSelection, this.policyId, assetName, quantity, fee, ttl);
  }

  async buildTokenIssueTxBody(
    recipient: string,
    assetName: string,
    quantity: number,
  ): Promise<CardanoWasm.TransactionBody> {
    let walletId = await this.walletId;

    // Token transfer require min 1 Ada
    const oneAda = 1000000;
    // Get coin selection / Tx inputs for paying fees
    const payment = {
      address: recipient,
      amount: { quantity: oneAda,
                unit: WalletswalletIdpaymentfeesAmountUnitEnum.Lovelace
              },
      assets: [
        { policy_id: Buffer.from(this.policyId.to_bytes()).toString('hex'),
          asset_name: Buffer.from(assetName).toString('hex'),
          quantity: quantity,
        }
      ]
    };
    const body: ApiPostTransactionFeeData = {
      payments: [payment],
    };
    const resp = await this.singleAddressWalletClient.coinSelection(body, walletId);
    const coinSelection = resp.data;
    logger.debug("AdaChain: buildTokenIssueTxBody: coinSelection", coinSelection)

    const ttl = await this.getCurrentSlotNumber() + 1000;
    // The coin-selection by cardano-wallet does not properly calculate min-fee
    // with assets, so add an extra amount to make Tx succeed
    const extraFee = 1000;

    return utils.makeTxBody(coinSelection, this.policyId, ttl, extraFee);
  }


  // TODO: we could hash the address, and directly check the walletId, removing
  // the need of wallet name.
  private async createOrRestoreSingleAddressWallet(
    address: string,
    name: string
  ) {
    let singleAddrWallets = await this.singleAddressWalletClient.listWallets();
    for (let w of singleAddrWallets.data) {
      if (w.name == name) {
        return w.id;
      }
    }
    let res = await this.createSingleAddressWallet(address, name);
    return res.id;
  }

  private async createSingleAddressWallet(
    address: string,
    name: string
  ) {
    let body: ApiSingleAddressWalletPostData =  {
      address: address,
      name: name
    }
    let res = await this.singleAddressWalletClient.postWallet(body);
	  return res.data;
  }
}
