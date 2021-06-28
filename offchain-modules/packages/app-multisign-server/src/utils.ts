import { ForceBridgeCore, bootstrapKeyStore } from '@force-bridge/x/dist/core';
import { Wallet } from 'ethers';

function parseCkbPrivateKeyToAddress(privateKey: string): string {
  const network = ForceBridgeCore.config.common.network;
  const ckbUtils = ForceBridgeCore.ckb.utils;
  const pubKey = ckbUtils.privateKeyToPublicKey(privateKey);

  if (network === 'mainnet') return ckbUtils.pubkeyToAddress(pubKey, { prefix: ckbUtils.AddressPrefix.Mainnet });
  return ckbUtils.pubkeyToAddress(pubKey, { prefix: ckbUtils.AddressPrefix.Testnet });
}

export function loadKeys(): void {
  const keystore = bootstrapKeyStore();

  ForceBridgeCore.config.ckb.multiSignKeys = keystore
    .listKeyIDs()
    .filter((id) => id.startsWith('ckb-multisig'))
    .map((id) => {
      const privKey = keystore.getDecryptedByKeyID(id);
      const address = parseCkbPrivateKeyToAddress(privKey);
      return { privKey, address };
    });

  ForceBridgeCore.config.eth.multiSignKeys = keystore
    .listKeyIDs()
    .filter((id) => id.startsWith('eth-multisig'))
    .map((id) => {
      const privKey = keystore.getDecryptedByKeyID(id);
      const address = new Wallet(privKey).address;
      return { privKey, address };
    });
}
