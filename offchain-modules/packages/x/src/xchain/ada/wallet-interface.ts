import * as CardanoWasm from '@emurgo/cardano-serialization-lib-nodejs';
import globalAxios, { AxiosPromise, AxiosInstance } from 'axios';
import { mnemonicToEntropy } from 'bip39';
import { ApiSingleAddressWalletPostData, SingleAddressWalletsApiFactory } from 'cardano-single-address-wallet-client';
import {
  WalletServer,
  ApiTransaction,
  WalletswalletIdpaymentfeesAmountUnitEnum,
  ApiPostTransactionFeeData,
} from 'cardano-wallet-js';
import { AdaConfig, forceBridgeRole } from '../../config';
import { ForceBridgeCore } from '../../core';
import { IAdaUnlock } from '../../db/model';
import { MultiSigMgr } from '../../multisig/multisig-mgr';
import { asyncSleep, retryPromise } from '../../utils';
import { logger } from '../../utils/logger';

import * as utils from './utils';

export class AdaChain {
  public readonly role: forceBridgeRole;
  public readonly config: AdaConfig;
  public readonly multisigMgr: MultiSigMgr;
  public readonly bridgeMultiSigAddr: string;
  public readonly bridgeMultiSigScript: CardanoWasm.NativeScript;
  private walletServer: WalletServer;
  private walletId: Promise<string>;
  private singleAddressWalletClient: any;

  constructor(role: forceBridgeRole, config) {
    this.role = role;
    this.config = config;
    try {
      const keyHashes: CardanoWasm.Ed25519KeyHash[] = [];
      for (const k of config.multiSignKeyHashes) {
        keyHashes.push(CardanoWasm.Ed25519KeyHash.from_bech32(k));
      }
      this.bridgeMultiSigScript = utils.createMultiSigScript(keyHashes, config.multiSignThreshold);
      this.bridgeMultiSigAddr = utils
        .getScriptAddress(this.bridgeMultiSigScript, config.networkId)
        .to_address()
        .to_bech32();
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
      const axiosInstance = globalAxios.create({ baseURL: config.walletRpcUrl });
      const configuration = {
        basePath: config.walletRpcUrl,
      };
      this.singleAddressWalletClient = SingleAddressWalletsApiFactory(
        configuration,
        config.walletRpcUrl,
        axiosInstance,
      );
    }

    this.walletId = this.createOrRestoreSingleAddressWallet(this.bridgeMultiSigAddr, config.walletName);
  }

  async getTransactions(startTime: string | undefined): Promise<ApiTransaction[]> {
    const walletId = await this.walletId;
    const res = await this.singleAddressWalletClient.listTransactions(walletId, startTime);
    return res.data;
  }

  async getCurrentSlotNumber(): Promise<{ network: number; node: number }> {
    const information = await this.walletServer.getNetworkInformation();
    const network_tip = information.network_tip;
    const node_tip = information.node_tip;
    if (network_tip == undefined || node_tip == undefined) {
      throw new Error('Could not get current slot number');
    } else {
      return { network: network_tip.absolute_slot_number, node: node_tip.absolute_slot_number };
    }
  }

  async getAvailableBalance(): Promise<number> {
    const walletId = await this.walletId;
    const res = await this.singleAddressWalletClient.getWallet(walletId);
    return res.data.balance.available.quantity;
  }

  async sendUnlockTxs(records: IAdaUnlock[]): Promise<string | boolean | Error> {
    const maxTryTimes = 30;
    for (let tryTime = 0; ; tryTime++) {
      logger.debug('contract balance', await this.getAvailableBalance());
      try {
        const { txBody, auxData } = await this.buildUnlockTxBody(records);
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
        for (const sig of signatures) {
          const vkeyWitness = CardanoWasm.Vkeywitness.from_bytes(Buffer.from(sig, 'hex'));
          vkeyWitnesses.add(vkeyWitness);
        }

        const witnesses = CardanoWasm.TransactionWitnessSet.new();
        witnesses.set_vkeys(vkeyWitnesses);
        const scripts = CardanoWasm.NativeScripts.new();
        scripts.add(this.bridgeMultiSigScript);
        witnesses.set_native_scripts(scripts);

        const transaction = CardanoWasm.Transaction.new(txBody, witnesses, auxData);

        const signedTx = Buffer.from(transaction.to_bytes()).toString('hex');
        const txId = await this.walletServer.submitTx(signedTx);
        logger.info('successfully sent signed tx', txId);
        return txId;
      } catch (e) {
        logger.error(`sendUnlockTxs error, records: ${records}, tryTime: ${tryTime}, error: ${e.stack}`);
        if (tryTime >= maxTryTimes) {
          return e;
        }
        await asyncSleep(15000);
      }
    }
  }

  private async buildUnlockTxBody(records: IAdaUnlock[]): Promise<TxBodyAndAuxData> {
    const walletId = await this.walletId;

    // Get coin selection / Tx inputs
    const payments = records.map((record) => {
      const amount = Number(record.amount);
      return {
        address: record.recipientAddress,
        amount: { quantity: amount, unit: WalletswalletIdpaymentfeesAmountUnitEnum.Lovelace },
      };
    });
    const metadata = {};
    const genTxMetadata = CardanoWasm.GeneralTransactionMetadata.new();
    records.forEach((record, index) => {
      metadata[index] = {
        bytes: record.ckbTxHash.slice(2), // remove 0x
      };
      const k = CardanoWasm.BigNum.from_str(index.toString());
      const v = CardanoWasm.TransactionMetadatum.new_bytes(Buffer.from(record.ckbTxHash.slice(2), 'hex'));
      genTxMetadata.insert(k, v);
    });
    const body: ApiPostTransactionFeeData = {
      payments: payments,
      metadata: metadata,
    };
    const resp = await this.singleAddressWalletClient.coinSelection(body, walletId);
    const coinSelection = resp.data;
    logger.debug('AdaChain: signUnlockRecords: coinSelection', coinSelection);

    // TODO: This should be configurable, and tracked by the verifiers
    const ttl = (await this.getCurrentSlotNumber()).node + 1000;

    const txBody = utils.makeTxBody(coinSelection, ttl);

    const auxData = CardanoWasm.AuxiliaryData.new();
    auxData.set_metadata(genTxMetadata);
    const auxDataHash = CardanoWasm.hash_auxiliary_data(auxData);
    txBody.set_auxiliary_data_hash(auxDataHash);
    return {
      txBody: txBody,
      auxData: auxData,
    };
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

  // TODO: we could hash the address, and directly check the walletId, removing
  // the need of wallet name.
  private async createOrRestoreSingleAddressWallet(address: string, name: string) {
    const singleAddrWallets = await this.singleAddressWalletClient.listWallets();
    for (const w of singleAddrWallets.data) {
      if (w.name == name) {
        return w.id;
      }
    }
    const res = await this.createSingleAddressWallet(address, name);
    return res.id;
  }

  private async createSingleAddressWallet(address: string, name: string) {
    const body: ApiSingleAddressWalletPostData = {
      address: address,
      name: name,
    };
    const res = await this.singleAddressWalletClient.postWallet(body);
    return res.data;
  }
}

interface TxBodyAndAuxData {
  txBody: CardanoWasm.TransactionBody;
  auxData: CardanoWasm.AuxiliaryData;
}
