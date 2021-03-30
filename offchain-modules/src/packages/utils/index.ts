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

export async function waitUntilCommitted(ckb, txHash, timeout) {
  let waitTime = 0;
  while (true) {
    const txStatus = await ckb.rpc.getTransaction(txHash);
    console.log(`tx ${txHash} status: ${txStatus.txStatus.status}, index: ${waitTime}`);
    if (txStatus.txStatus.status === 'committed') {
      return txStatus;
    }
    await asyncSleep(1000);
    waitTime += 1;
    if (waitTime >= timeout) {
      return txStatus;
    }
  }
}

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
  const tmpUint8Array = new Uint8Array(arr);
  return tmpUint8Array;
}

export function isEmptyArray<T>(array: T[]): boolean {
  return !(array && array.length);
}
