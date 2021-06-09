import fs from 'fs';
import * as utils from '@nervosnetwork/ckb-sdk-utils';
import * as lodash from 'lodash';
import { Connection, createConnection, getConnectionManager, getConnectionOptions } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { ForceBridgeCore } from '../core';
import { BtcLock } from '../db/entity/BtcLock';
import { BtcUnlock } from '../db/entity/BtcUnlock';
import { CkbBurn } from '../db/entity/CkbBurn';
import { CkbMint } from '../db/entity/CkbMint';
import { EosLock } from '../db/entity/EosLock';
import { EosUnlock } from '../db/entity/EosUnlock';
import { EthLock } from '../db/entity/EthLock';
import { EthUnlock } from '../db/entity/EthUnlock';
import { SignedTx } from '../db/entity/SignedTx';
import { TronLock } from '../db/entity/TronLock';
import { TronUnlock } from '../db/entity/TronUnlock';
import { KV } from '../db/entity/kv';
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
  const ormCfg = ForceBridgeCore.config.common.orm;
  return createConnection({
    type: ormCfg.type,
    host: ormCfg.host,
    port: ormCfg.port,
    username: ormCfg.username,
    password: ormCfg.password,
    database: ormCfg.database,
    timezone: ormCfg.timezone,
    synchronize: ormCfg.synchronize,
    logging: ormCfg.logging,
    entities: [
      BtcLock,
      BtcUnlock,
      CkbBurn,
      CkbMint,
      EosLock,
      EosUnlock,
      EthLock,
      EthUnlock,
      KV,
      SignedTx,
      TronLock,
      TronUnlock,
    ],
    namingStrategy: new SnakeNamingStrategy(),
  });
}
