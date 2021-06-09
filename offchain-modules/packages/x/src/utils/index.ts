import fs from 'fs';
import * as utils from '@nervosnetwork/ckb-sdk-utils';
import Knex from 'knex';
import * as lodash from 'lodash';
import nconf from 'nconf';
import { Connection, createConnection, getConnectionManager, getConnectionOptions } from 'typeorm';
import { asserts, nonNullable } from '../errors';
import { logger } from './logger';

export function asyncSleep(ms = 0): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function blake2b(buffer: Uint8Array): Uint8Array {
  return utils.blake2b(32, null, null, utils.PERSONAL).update(buffer).digest('binary') as Uint8Array;
}

export function genRandomHex(size: number): string {
  return '0x' + [...Array(size)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
}

export const bigintToSudtAmount = (n: bigint): string => {
  return `0x${Buffer.from(n.toString(16).padStart(32, '0'), 'hex').reverse().toString('hex')}`;
};

export const fromHexString = (hexString: string): Uint8Array => {
  const matched = nonNullable(hexString.match(/[\da-f]{2}/gi));
  return new Uint8Array(matched.map((byte) => parseInt(byte, 16)));
};

export const toHexString = (bytes: Uint8Array): string =>
  bytes.reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '');

export function uint8ArrayToString(data: Uint8Array): string {
  let dataString = '';
  for (let i = 0; i < data.length; i++) {
    dataString += String.fromCharCode(data[i]);
  }
  return dataString;
}

export function stringToUint8Array(str: string): Uint8Array {
  const arr: number[] = [];
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

export async function getDBConnection(): Promise<Connection> {
  const connectionManager = await getConnectionManager();
  // init db and start handlers
  let conn: Connection;
  if (!connectionManager.has('default')) {
    // ? load connection options from ormconfig or environment
    logger.info(`getDBConnection create One`);
    conn = await createConnection();
  } else {
    logger.info(`getDBConnection have One`);
    conn = await connectionManager.get();
  }
  return conn;
}
