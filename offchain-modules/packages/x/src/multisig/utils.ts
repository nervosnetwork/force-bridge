import * as utils from '@nervosnetwork/ckb-sdk-utils';
import { ec as EC, SignatureInput } from 'elliptic';
import * as lodash from 'lodash';
import { ForceBridgeCore } from '../core';
import { collectSignaturesParams } from './multisig-mgr';

const ec = new EC('secp256k1');

export function signVerify(message: string, signature: string, pubKeyHash: string): boolean {
  const msgBuffer = Buffer.from(message.slice(2), 'hex');
  const sigBuffer = Buffer.from(signature.slice(2), 'hex');
  const sign: SignatureInput = {
    r: sigBuffer.slice(0, 32),
    s: sigBuffer.slice(32, 64),
    recoveryParam: sigBuffer[64],
  };
  const point = ec.recoverPubKey(msgBuffer, sign, sign.recoveryParam!);
  const encodePoint = point.encode('hex', true);
  const pkHash = utils.blake160('0x' + encodePoint.toLowerCase(), 'hex');
  if (pkHash !== pubKeyHash.slice(2)) {
    return false;
  }
  const pubKey = ec.keyFromPublic(encodePoint, 'hex');
  return pubKey.verify(message.slice(2), sign);
}

export function verifyCollector(params: collectSignaturesParams): boolean {
  const cParams = lodash.cloneDeep(params);
  cParams.collectorSig = '';
  const rawData = JSON.stringify(cParams, undefined);
  const data = new Buffer(rawData).toString('hex');
  const message = '0x' + utils.blake160('0x' + data, 'hex');
  return ForceBridgeCore.config.common.collectorPubKeyHash.some((pkHash) => {
    return signVerify(message, params.collectorSig!, pkHash);
  });
}
