import * as utils from '@nervosnetwork/ckb-sdk-utils';

export function asyncSleep(ms = 0) {
  return new Promise((r) => setTimeout(r, ms));
}

export function blake2b(buffer) {
  return utils.blake2b(32, null, null, utils.PERSONAL).update(buffer).digest('binary');
}

export function genRandomHex(size: number) {
  return '0x' + [...Array(size)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
}

export function isEmptyArray<T>(array: T[]): boolean {
  return !(array && array.length);
}
