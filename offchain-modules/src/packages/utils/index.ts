import * as utils from '@nervosnetwork/ckb-sdk-utils';
const nconf = require('nconf');

export function asyncSleep(ms = 0) {
  return new Promise((r) => setTimeout(r, ms));
}

export function blake2b(buffer) {
  return utils.blake2b(32, null, null, utils.PERSONAL).update(buffer).digest('binary');
}

export function genRandomHex(size: number) {
  return '0x' + [...Array(size)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
}

export const fromHexString = (hexString) =>
  new Uint8Array(hexString.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));

export function uint8ArrayToString(data): string {
  let dataString = '';
  for (let i = 0; i < data.length; i++) {
    dataString += String.fromCharCode(data[i]);
  }
  return dataString;
}
