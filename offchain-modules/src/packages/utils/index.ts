import * as utils from '@nervosnetwork/ckb-sdk-utils';
import fs from 'fs';
import * as lodash from 'lodash';

export function asyncSleep(ms = 0) {
  return new Promise((r) => setTimeout(r, ms));
}

export function blake2b(buffer) {
  return utils.blake2b(32, null, null, utils.PERSONAL).update(buffer).digest('binary');
}

export function genRandomHex(size: number) {
  return '0x' + [...Array(size)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
}

export const bigintToSudtAmount = (n) => {
  return `0x${Buffer.from(n.toString(16).padStart(32, '0'), 'hex').reverse().toString('hex')}`;
};

export const fromHexString = (hexString) =>
  new Uint8Array(hexString.match(/[\da-f]{2}/gi).map((byte) => parseInt(byte, 16)));

export const toHexString = (bytes) => bytes.reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '');

export function uint8ArrayToString(data): string {
  let dataString = '';
  for (let i = 0; i < data.length; i++) {
    dataString += String.fromCharCode(data[i]);
  }
  return dataString;
}

export function stringToUint8Array(str): Uint8Array {
  const arr = [];
  for (let i = 0, j = str.length; i < j; ++i) {
    arr.push(str.charCodeAt(i));
  }
  return new Uint8Array(arr);
}

export function isEmptyArray<T>(array: T[]): boolean {
  return !(array && array.length);
}

export function parsePrivateKey(path: string): string {
  if (fs.existsSync(path)) {
    const pk = `${fs.readFileSync(path)}`;
    return lodash.trim(pk);
  } else {
    return path;
  }
}
