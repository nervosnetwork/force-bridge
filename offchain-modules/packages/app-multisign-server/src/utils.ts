import { ForceBridgeCore, bootstrapKeyStore } from '@force-bridge/x/dist/core';
import { Wallet } from 'ethers';

function parseCkbPrivateKeyToAddress(privateKey: string): string {
  const network = ForceBridgeCore.config.common.network;
  const ckbUtils = ForceBridgeCore.ckb.utils;
  const pubKey = ckbUtils.privateKeyToPublicKey(privateKey);

  if (network === 'mainnet') return ckbUtils.pubkeyToAddress(pubKey, { prefix: ckbUtils.AddressPrefix.Mainnet });
  return ckbUtils.pubkeyToAddress(pubKey, { prefix: ckbUtils.AddressPrefix.Testnet });
}
