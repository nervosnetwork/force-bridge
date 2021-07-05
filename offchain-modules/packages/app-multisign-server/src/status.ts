import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { privateKeyToCkbAddress, privateKeyToCkbPubkeyHash, privateKeyToEthAddress } from '@force-bridge/x/dist/utils';
import * as lodash from 'lodash';
import { SigResponse, SigServer } from './sigServer';

export async function serverStatus(): Promise<SigResponse> {
  const [latestCkbHeight, latestCkbBlockHash] = lodash.split(await SigServer.kvDb.get('lastHandleCkbBlock'), ',', 2);
  const [latestEthHeight, latestEthBlockHash] = lodash.split(await SigServer.kvDb.get('lastHandleEthBlock'), ',', 2);
  const data = {
    addressConfig: {
      ethAddress: privateKeyToEthAddress(ForceBridgeCore.config.eth.privateKey),
      ckbPubkeyHash: privateKeyToCkbPubkeyHash(ForceBridgeCore.config.ckb.privateKey),
      ckbAddress: privateKeyToCkbAddress(ForceBridgeCore.config.ckb.privateKey),
    },
    latestChainStatus: {
      ckb: {
        latestCkbHeight,
        latestCkbBlockHash,
      },
      eth: {
        latestEthHeight,
        latestEthBlockHash,
      },
    },
  };
  return SigResponse.fromData(data);
}
