import * as CardanoWasm from '@emurgo/cardano-serialization-lib-nodejs';
import { WalletServer, AddressWallet, TransactionWallet, Seed, ApiCoinSelection, WalletsAssetsAvailable } from 'cardano-wallet-js';
import { mnemonicToEntropy } from 'bip39';
import globalAxios from 'axios';
import { ApiSingleAddressWalletPostData, SingleAddressWalletsApiFp } from 'cardano-single-address-wallet-client';

export function cardanoMainnetNetworkId(): number {
  return CardanoWasm.NetworkId.mainnet().kind();
}

export function cardanoTestnetNetworkId(): number {
  return CardanoWasm.NetworkId.testnet().kind();
}

export function createMultiSigScript(keyhashes: CardanoWasm.Ed25519KeyHash[], multisig_threshold: number): CardanoWasm.NativeScript {
  if (multisig_threshold > keyhashes.length) {
    throw Error("multisig_threshold greater than keyhashes.length");
  }
  var s_all = CardanoWasm.NativeScripts.new();
  for (let k of keyhashes) {
    let script_key = CardanoWasm.ScriptPubkey.new(k);
    s_all.add(CardanoWasm.NativeScript.new_script_pubkey(script_key));
  }
  if (multisig_threshold == keyhashes.length) {
    return CardanoWasm.NativeScript.new_script_all(CardanoWasm.ScriptAll.new(s_all));
  } else {
    return CardanoWasm.NativeScript.new_script_n_of_k(CardanoWasm.ScriptNOfK.new(multisig_threshold, s_all));
  }
}

export function getScriptAddress(script: CardanoWasm.NativeScript, network_id: number): CardanoWasm.EnterpriseAddress {
  var cred = CardanoWasm.StakeCredential.from_scripthash(getScriptHash(script));
  return CardanoWasm.EnterpriseAddress.new(network_id, cred);
}

export function getScriptHash(script: CardanoWasm.NativeScript): CardanoWasm.ScriptHash {
  let sh1 = script.hash(CardanoWasm.ScriptHashNamespace.NativeScript);
  return CardanoWasm.ScriptHash.from_bytes(sh1.to_bytes());
}

export function mnemonicToRootKey(mnemonic: string): CardanoWasm.Bip32PrivateKey {
  const entropy = mnemonicToEntropy(mnemonic)
  const rootKey = CardanoWasm.Bip32PrivateKey.from_bip39_entropy(
    Buffer.from(entropy, 'hex'),
    Buffer.from(''),
  );
  return rootKey
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
  CIP1852=1852, // see CIP 1852
  CIP1854=1854, // see CIP 1854
}

// Cardano coin type (SLIP 44)
enum CoinTypes {
  CARDANO=1815,
}

enum ChainDerivation {
  EXTERNAL=0, // from BIP44
  INTERNAL=1, // from BIP44
  CHIMERIC=2, // from CIP1852
}

export function deriveRootKeyForAccount(rootKey: CardanoWasm.Bip32PrivateKey, account: number): CardanoWasm.Bip32PrivateKey {
  return rootKey
    .derive(harden(Purpose.CIP1854)) // purpose
    .derive(harden(CoinTypes.CARDANO)) // coin type
    .derive(harden(account)); // account
}

export function deriveSigningKey(rootKey: CardanoWasm.Bip32PrivateKey, account: number, index: number): CardanoWasm.Bip32PrivateKey {
  return deriveRootKeyForAccount(rootKey, account)
    .derive(0) // payment
    .derive(index)
}

export function privateKeyToAdaPubkeyHash(k: CardanoWasm.Bip32PrivateKey): string {
  // see https://github.com/input-output-hk/cardano-addresses/blob/27eed933b67064542879729cb8a34b8a4ae69ed2/core/lib/Cardano/Codec/Bech32/Prefixes.hs#L186
  return k.to_public().to_raw_key().hash().to_bech32("addr_vkh");
}

export function makeTxBody(
  coinSelection: ApiCoinSelection,
  policyId: CardanoWasm.ScriptHash,
  ttl: number,
  extraFee: number = 0,
): CardanoWasm.TransactionBody {
  let txInputs = CardanoWasm.TransactionInputs.new();
  for (let input of coinSelection.inputs) {
    const txHash = CardanoWasm.TransactionHash.from_bytes(Buffer.from(input.id, 'hex'));
    const txInput = CardanoWasm.TransactionInput.new(txHash, input.index);
    txInputs.add(txInput);
  }

  let txOutputs = CardanoWasm.TransactionOutputs.new();

  for (let output of coinSelection.outputs) {
    const address = CardanoWasm.Address.from_bech32(output.address);
    const amount = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(output.amount.quantity.toString()));
    setMultiAssets(output.assets, amount, policyId);
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
  let changeAssets: WalletsAssetsAvailable[] = [];
  for (let output of coinSelection.change) {
    if (changeAddress == '' ) {
      changeAddress = output.address;
    } else if (changeAddress != output.address) {
      singleChangeOutput = false;
      break;
    }
    changeAmount = changeAmount.checked_add(CardanoWasm.BigNum.from_str(output.amount.quantity.toString()));
    if (output.assets != undefined) {
      changeAssets = changeAssets.concat(output.assets);
    }
  }

  if (singleChangeOutput && changeAddress != '') {
    const address = CardanoWasm.Address.from_bech32(changeAddress);
    if (extraFee != 0) {
      changeAmount = changeAmount.checked_sub(CardanoWasm.BigNum.from_str(extraFee.toString()));
    }
    const amount = CardanoWasm.Value.new(changeAmount);
    setMultiAssets(changeAssets, amount, policyId);
    const txOutput = CardanoWasm.TransactionOutput.new(address, amount);
    txOutputs.add(txOutput);
  } else {
    for (let output of coinSelection.change) {
      const address = CardanoWasm.Address.from_bech32(output.address);
      const amount = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(output.amount.quantity.toString()));
      setMultiAssets(output.assets, amount, policyId);
      const txOutput = CardanoWasm.TransactionOutput.new(address, amount);
      txOutputs.add(txOutput);
    }
  }

	let fee = coinSelection.inputs.reduce((acc, c) => c.amount.quantity + acc, 0)
		+ (coinSelection.withdrawals?.reduce((acc, c) => c.amount.quantity + acc, 0) || 0)
		- coinSelection.outputs.reduce((acc, c) => c.amount.quantity + acc, 0)
		- coinSelection.change.reduce((acc, c) => c.amount.quantity + acc, 0)
		- (coinSelection.deposits?.reduce((acc, c) => c.quantity + acc, 0) || 0)
    + extraFee;
  return CardanoWasm.TransactionBody.new(txInputs, txOutputs, CardanoWasm.BigNum.from_str(fee.toString()), ttl);
}

// Multi-Asset

export function stringToAssetName(str: string): CardanoWasm.AssetName {
  return CardanoWasm.AssetName.new(Buffer.from(str, 'utf8'));
}

export function renderAssetName(hex_string: string): string {
  return Buffer.from(hex_string, "hex").toString();
}

// The coinSelection is assumed to be self-transfer
export function makeMintTxBody(
  coinSelection,
  policyId,
  assetNameStr,
  assetValueN,
  feeInt,
  ttl,
): CardanoWasm.TransactionBody {
  let assetName = stringToAssetName(assetNameStr);
  let assetValue = CardanoWasm.Int.new_i32(assetValueN);

  let inAmount = CardanoWasm.BigNum.zero();

  let txInputs = CardanoWasm.TransactionInputs.new();
  for (let input of coinSelection.inputs) {
    const txHash = CardanoWasm.TransactionHash.from_bytes(Buffer.from(input.id, 'hex'));
    const txInput = CardanoWasm.TransactionInput.new(txHash, input.index);
    txInputs.add(txInput);
    inAmount = inAmount.checked_add(CardanoWasm.BigNum.from_str(input.amount.quantity.toString()));
  }

  const fee = CardanoWasm.BigNum.from_str(feeInt.toString())
  const changeAmount = inAmount.checked_sub(fee);

  let txOutputs = CardanoWasm.TransactionOutputs.new();
  const address = CardanoWasm.Address.from_bech32(coinSelection.outputs[0].address);
  const amount = CardanoWasm.Value.new(changeAmount);

  const assets = CardanoWasm.Assets.new();

  // @ts-ignore
  assets.insert(assetName, assetValue.as_positive());
  const multiAsset = CardanoWasm.MultiAsset.new();
  multiAsset.insert(policyId, assets);
  amount.set_multiasset(multiAsset);
  const txOutput = CardanoWasm.TransactionOutput.new(address, amount);
  txOutputs.add(txOutput);

  let txBody = CardanoWasm.TransactionBody.new(txInputs, txOutputs, fee, ttl);

  let mintAssets = CardanoWasm.MintAssets.new();
  mintAssets.insert(assetName, assetValue);
  let mint = CardanoWasm.Mint.new();
  mint.insert(policyId, mintAssets);
  txBody.set_mint(mint);
  return txBody;
}

function setMultiAssets(assetArray, value, policyId) {
  if (assetArray.length > 0) {
    const assets = CardanoWasm.Assets.new();
    for (let asset of assetArray) {
      const assetName = stringToAssetName(renderAssetName(asset.asset_name));
      const quantity = CardanoWasm.BigNum.from_str(asset.quantity.toString());
      assets.insert(assetName, quantity);
    }
    let multiAsset = value.multiasset();
    if (multiAsset == undefined) {
      multiAsset = CardanoWasm.MultiAsset.new();
    }
    multiAsset.insert(policyId, assets);
    value.set_multiasset(multiAsset);
  }
}
