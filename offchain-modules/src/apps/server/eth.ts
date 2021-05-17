import { ethers } from 'ethers';
import { ForceBridgeCore } from '@force-bridge/core';
import { logger } from '@force-bridge/utils/logger';
import { SigServer } from './sigserver';
const { ecsign, toRpcSig } = require('ethereumjs-util');

export async function signEthTx(payload): Promise<string> {
  //FIXME: verify eth_tx payload.
  logger.debug('signEthTx msg: ', payload);
  const args = require('minimist')(process.argv.slice(2));
  const index = args.index;
  const privKey = SigServer.config.eth.multiSignKeys[index];
  const wallet = new ethers.Wallet(privKey, SigServer.ethProvider);
  const { v, r, s } = ecsign(
    Buffer.from(payload.rawData.slice(2), 'hex'),
    Buffer.from(wallet.privateKey.slice(2), 'hex'),
  );
  const sigHex = toRpcSig(v, r, s);
  return sigHex.slice(2);
}
