import * as CardanoWasm from '@emurgo/cardano-serialization-lib-nodejs';
import globalAxios from 'axios';
import { mnemonicToEntropy } from 'bip39';
import { ApiSingleAddressWalletPostData, SingleAddressWalletsApiFp } from 'cardano-single-address-wallet-client';
import { WalletServer, AddressWallet, TransactionWallet, Seed, ApiCoinSelection } from 'cardano-wallet-js';

export function cardanoMainnetNetworkId(): number {
  return CardanoWasm.NetworkId.mainnet().kind();
}

export function cardanoTestnetNetworkId(): number {
  return CardanoWasm.NetworkId.testnet().kind();
}

export function createMultiSigScript(
  keyhashes: CardanoWasm.Ed25519KeyHash[],
  multisig_threshold: number,
): CardanoWasm.NativeScript {
  if (multisig_threshold > keyhashes.length) {
    throw Error('multisig_threshold greater than keyhashes.length');
  }
  const s_all = CardanoWasm.NativeScripts.new();
  for (const k of keyhashes) {
    const script_key = CardanoWasm.ScriptPubkey.new(k);
    s_all.add(CardanoWasm.NativeScript.new_script_pubkey(script_key));
  }
  if (multisig_threshold == keyhashes.length) {
    return CardanoWasm.NativeScript.new_script_all(CardanoWasm.ScriptAll.new(s_all));
  } else {
    return CardanoWasm.NativeScript.new_script_n_of_k(CardanoWasm.ScriptNOfK.new(multisig_threshold, s_all));
  }
}

export function getScriptAddress(script: CardanoWasm.NativeScript, network_id: number): CardanoWasm.EnterpriseAddress {
  const cred = CardanoWasm.StakeCredential.from_scripthash(getScriptHash(script));
  return CardanoWasm.EnterpriseAddress.new(network_id, cred);
}

export function getScriptHash(script: CardanoWasm.NativeScript): CardanoWasm.ScriptHash {
  const sh1 = script.hash(CardanoWasm.ScriptHashNamespace.NativeScript);
  return CardanoWasm.ScriptHash.from_bytes(sh1.to_bytes());
}

export function mnemonicToRootKey(mnemonic: string): CardanoWasm.Bip32PrivateKey {
  const entropy = mnemonicToEntropy(mnemonic);
  const rootKey = CardanoWasm.Bip32PrivateKey.from_bip39_entropy(Buffer.from(entropy, 'hex'), Buffer.from(''));
  return rootKey;
}

// HD Address derivation

//   m / purpose' / coin_type' / account' / role / index
// https://github.com/cardano-foundation/CIPs/blob/master/CIP-1854/CIP-1854.md#hd-derivation

// > we reserve however purpose=1854' to distinguish multisig wallets from
// > standard wallets role=0 is used to identify payment keys, whereas role=2
// > identifies stake keys. role=1 is left unused for multisig wallets.

// purpose 	coin_type 	account_ix 	      role 	  index
// 1854' 	  1815' 	    [2^31 .. 2^32-1] 	0 or 2 	[0 .. 2^31-1]

// Example
// m/1854’/1815’/0’/0/0

function harden(num: number): number {
  return 0x80000000 + num;
}

// Purpose derivation (See BIP43)
enum Purpose {
  CIP1852 = 1852, // see CIP 1852
  CIP1854 = 1854, // see CIP 1854
}

// Cardano coin type (SLIP 44)
enum CoinTypes {
  CARDANO = 1815,
}

enum ChainDerivation {
  EXTERNAL = 0, // from BIP44
  INTERNAL = 1, // from BIP44
  CHIMERIC = 2, // from CIP1852
}

export function deriveRootKeyForAccount(
  rootKey: CardanoWasm.Bip32PrivateKey,
  account: number,
): CardanoWasm.Bip32PrivateKey {
  return rootKey
    .derive(harden(Purpose.CIP1854)) // purpose
    .derive(harden(CoinTypes.CARDANO)) // coin type
    .derive(harden(account)); // account
}

export function deriveSigningKey(
  rootKey: CardanoWasm.Bip32PrivateKey,
  account: number,
  index: number,
): CardanoWasm.Bip32PrivateKey {
  return deriveRootKeyForAccount(rootKey, account)
    .derive(0) // payment
    .derive(index);
}

export function privateKeyToAdaPubkeyHash(k: CardanoWasm.Bip32PrivateKey): string {
  // see https://github.com/input-output-hk/cardano-addresses/blob/27eed933b67064542879729cb8a34b8a4ae69ed2/core/lib/Cardano/Codec/Bech32/Prefixes.hs#L186
  return k.to_public().to_raw_key().hash().to_bech32('addr_vkh');
}

export function makeTxBody(coinSelection: ApiCoinSelection, ttl: number): CardanoWasm.TransactionBody {
  const txInputs = CardanoWasm.TransactionInputs.new();
  for (const input of coinSelection.inputs) {
    const txHash = CardanoWasm.TransactionHash.from_bytes(Buffer.from(input.id, 'hex'));
    const txInput = CardanoWasm.TransactionInput.new(txHash, input.index);
    txInputs.add(txInput);
  }

  const txOutputs = CardanoWasm.TransactionOutputs.new();

  for (const output of coinSelection.outputs) {
    const address = CardanoWasm.Address.from_bech32(output.address);
    const amount = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(output.amount.quantity.toString()));
    const txOutput = CardanoWasm.TransactionOutput.new(address, amount);
    txOutputs.add(txOutput);
  }

  // The coinSelection somehow contains multiple change outputs, all to the same
  // address. The following code combines all into one output to save on the Tx
  // size. Note: this should reduce the min Tx fees slightly compared to the
  // computed by the cardano-wallet.
  // It would be better to fix the cardano-wallet code itself, so that the fees
  // calculation happens correctly.
  let singleChangeOutput = true;
  let changeAddress = '';
  let changeAmount = CardanoWasm.BigNum.zero();
  for (const output of coinSelection.change) {
    if (changeAddress == '') {
      changeAddress = output.address;
    } else if (changeAddress != output.address) {
      singleChangeOutput = false;
      break;
    }
    changeAmount = changeAmount.checked_add(CardanoWasm.BigNum.from_str(output.amount.quantity.toString()));
  }

  if (singleChangeOutput && changeAddress != '') {
    const address = CardanoWasm.Address.from_bech32(changeAddress);
    const amount = CardanoWasm.Value.new(changeAmount);
    const txOutput = CardanoWasm.TransactionOutput.new(address, amount);
    txOutputs.add(txOutput);
  } else {
    for (const output of coinSelection.change) {
      const address = CardanoWasm.Address.from_bech32(output.address);
      const amount = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(output.amount.quantity.toString()));
      const txOutput = CardanoWasm.TransactionOutput.new(address, amount);
      txOutputs.add(txOutput);
    }
  }

  const fee =
    coinSelection.inputs.reduce((acc, c) => c.amount.quantity + acc, 0) +
    (coinSelection.withdrawals?.reduce((acc, c) => c.amount.quantity + acc, 0) || 0) -
    coinSelection.outputs.reduce((acc, c) => c.amount.quantity + acc, 0) -
    coinSelection.change.reduce((acc, c) => c.amount.quantity + acc, 0) -
    (coinSelection.deposits?.reduce((acc, c) => c.quantity + acc, 0) || 0);
  return CardanoWasm.TransactionBody.new(txInputs, txOutputs, CardanoWasm.BigNum.from_str(fee.toString()), ttl);
}
