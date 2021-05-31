import { MultiSignKey } from '@force-bridge/x/dist/config';
import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { parsePrivateKey } from '@force-bridge/x/dist/utils';

export function loadKeys() {
  if (ForceBridgeCore.config.ckb !== undefined) {
    ForceBridgeCore.config.ckb.multiSignKeys = ForceBridgeCore.config.ckb.multiSignKeys.map((pk) => {
      return {
        address: pk.address,
        privKey: parsePrivateKey(pk.privKey),
      };
    });
  }
  if (ForceBridgeCore.config.eth !== undefined) {
    ForceBridgeCore.config.eth.multiSignKeys = ForceBridgeCore.config.eth.multiSignKeys.map((pk) => {
      return {
        address: pk.address,
        privKey: parsePrivateKey(pk.privKey),
      };
    });
  }
}
