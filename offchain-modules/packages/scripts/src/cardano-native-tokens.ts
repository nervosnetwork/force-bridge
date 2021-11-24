import fs from 'fs';
import path from 'path';
import { ValInfos } from '@force-bridge/cli/src/changeVal';
import { KeyStore } from '@force-bridge/keystore/dist';
import { OwnerCellConfig } from '@force-bridge/x/dist/ckb/tx-helper/deploy';
import { AdaConfig, Config, WhiteListEthAsset, CkbDeps } from '@force-bridge/x/dist/config';
import { asyncSleep, privateKeyToCkbPubkeyHash, writeJsonToFile, genRandomHex } from '@force-bridge/x/dist/utils';
import { logger, initLog } from '@force-bridge/x/dist/utils/logger';
import * as utils from '@force-bridge/x/dist/xchain/ada/utils';
import { AdaChain } from '@force-bridge/x/dist/xchain/ada/wallet-interface';
import * as lodash from 'lodash';
import * as shelljs from 'shelljs';
import { execShellCmd, pathFromProjectRoot } from './utils';
import { genRandomVerifierConfig, AdaVerifierConfig } from './utils/deploy-cardano';
import * as CardanoWasm from '@emurgo/cardano-serialization-lib-nodejs';
import { WalletServer, AddressWallet } from 'cardano-wallet-js';
import { getUserWallet } from './utils/cardano_batch_test';


async function main() {
  initLog({ level: 'debug', identity: 'integration' });
  logger.info('Start cardano native token test');

  const MULTISIG_NUMBER = 2;
  const MULTISIG_THRESHOLD = 2;
  const CARDANO_WALLET_RPC_URL = 'http://127.0.0.1:8190/v2';

  const verifierConfigs = lodash.range(MULTISIG_NUMBER).map((_i) => genRandomVerifierConfig());

  const adaConfig = {
    walletRpcUrl: CARDANO_WALLET_RPC_URL,
    walletName: 'FORCE_BRIDGE_TEST_INTEG_WALLET' + genRandomHex(16),
    multiSignKeyHashes: verifierConfigs.map((v) => v.adaPubkeyHash),
    multiSignHosts: [],
    multiSignThreshold: MULTISIG_THRESHOLD,
    confirmNumber: 10,
    startBlockHeight: 1,
    networkId: utils.cardanoTestnetNetworkId(),
  };
  const role = 'watcher';
  const adaChain = new AdaChain(role, adaConfig);

  const signingKeys = verifierConfigs.map((v) => CardanoWasm.PrivateKey.from_extended_bytes(Buffer.from(v.adaSigningKey, 'hex')));

  let sendTx = async function (txBody: CardanoWasm.TransactionBody) {
    return signAndSendTx (adaChain.walletServer, signingKeys, adaChain.bridgeMultiSigScript, txBody);
  }

  // Add some funds to bridge account to pay fees, etc
  await addFundsToBridge(adaChain.bridgeMultiSigAddr, 100000000, CARDANO_WALLET_RPC_URL);
  await asyncSleep(30000);

  const assetName = "Cardano-CKB";

  { // mint
    const txBody = await adaChain.buildMintTxBody(assetName, 10000);

    let txId = await sendTx(txBody);
    logger.info('Successfully minted tokens', txId);
  }

  await asyncSleep(10000);
  { // issue tokens
    const recipient = 'addr_test1qzzjqnklrkzpfd9tglty6llmf958f7tsy3axavhhmey0n8c4a05fk35vqa77wdtvrllelfa3rk0tn8g9kgvhks8983ns6luew0';
    const txBody = await adaChain.buildTokenIssueTxBody(recipient, assetName, 1000);

    let txId = await sendTx(txBody);
    logger.info('Successfully transfered tokens', txId);
  }
}

async function signAndSendTx(
  walletServer: WalletServer,
  signingKeys: CardanoWasm.PrivateKey[],
  native_script: CardanoWasm.NativeScript,
  txBody: CardanoWasm.TransactionBody,
): Promise<string> {
  const txHash = CardanoWasm.hash_transaction(txBody);
  const vkeyWitnesses = CardanoWasm.Vkeywitnesses.new();
  for (let prvKey of signingKeys) {
		const vkeyWitness = CardanoWasm.make_vkey_witness(txHash, prvKey);
    vkeyWitnesses.add(vkeyWitness);
  }

  const witnesses = CardanoWasm.TransactionWitnessSet.new();
  witnesses.set_vkeys(vkeyWitnesses);
  let scripts = CardanoWasm.NativeScripts.new();
  scripts.add(native_script);
  witnesses.set_native_scripts(scripts);

  const transaction = CardanoWasm.Transaction.new(
    txBody,
    witnesses,
    undefined,
  );
  let signedTx = Buffer.from(transaction.to_bytes()).toString('hex');
  let txId = await walletServer.submitTx(signedTx);
  return txId;
}

async function addFundsToBridge(
  adaForceBridgeAddr: string,
  amount: number,
  WALLET_SERVER_URL: string,
) {
  const ADA_TEST_MNEMONIC = "surface column cluster fog rely clap small armor horn worry festival dawn chuckle gospel vague melt lift reduce dish razor secret gloom glide correct";
  let bridgeAddr = [new AddressWallet(adaForceBridgeAddr)];
  let passphrase = 'user_wallet_passphrase';
  let adaWallet = await getUserWallet(WALLET_SERVER_URL, ADA_TEST_MNEMONIC, passphrase);

  await adaWallet.sendPayment(passphrase, bridgeAddr, [amount]);
  logger.info("Successfully added funds to bridge account");
  return;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error(`Cardano native token test failed, error: ${error.stack}`);
    process.exit(1);
  });
