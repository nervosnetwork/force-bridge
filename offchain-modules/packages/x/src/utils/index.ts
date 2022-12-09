import fs from 'fs';
import path from 'path';
import { parseAddress, TransactionSkeletonType } from '@ckb-lumos/helpers';

import * as utils from '@nervosnetwork/ckb-sdk-utils';
import { AddressPrefix } from '@nervosnetwork/ckb-sdk-utils';
import { ethers } from 'ethers';
import * as lodash from 'lodash';
import { Connection, createConnection } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { ForceBridgeCore } from '../core';
import { BtcLock } from '../db/entity/BtcLock';
import { BtcUnlock } from '../db/entity/BtcUnlock';
import { CkbBurn } from '../db/entity/CkbBurn';
import { CkbMint, CollectorCkbMint } from '../db/entity/CkbMint';
import { EosLock } from '../db/entity/EosLock';
import { EosUnlock } from '../db/entity/EosUnlock';
import { EthLock } from '../db/entity/EthLock';
import { CollectorEthUnlock, EthUnlock } from '../db/entity/EthUnlock';
import { SignedTx } from '../db/entity/SignedTx';
import { TronLock } from '../db/entity/TronLock';
import { TronUnlock } from '../db/entity/TronUnlock';
import { WithdrawedBridgeFee } from '../db/entity/WithdrawedBridgeFee';
import { KV } from '../db/entity/kv';
import { Sudt } from '../db/entity/sudt';
import { nonNullable } from '../errors';

export { asyncSleep, retryPromise, foreverPromise } from './promise';

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

export function getFromEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value !== undefined) {
    return value;
  }
  if (defaultValue !== undefined) {
    return defaultValue;
  } else {
    throw new Error(`${key} not provided in ENV`);
  }
}

export function writeJsonToFile(obj: unknown, writePath: string): void {
  const data = JSON.stringify(obj, null, 2);
  const dir = path.dirname(writePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(writePath, data);
}

export function privateKeyToCkbPubkeyHash(privkey: string): string {
  const pubkey = utils.privateKeyToPublicKey(privkey);
  const hash = utils.blake160(pubkey, 'hex');
  return `0x${hash}`;
}

export function privateKeyToEthAddress(privkey: string): string {
  return ethers.utils.computeAddress(privkey);
}

export type ckbAddressPrefix = AddressPrefix | 'mainnet' | 'testnet' | 'ckb' | 'cbt';

export function privateKeyToCkbAddress(privkey: string, prefix: ckbAddressPrefix = AddressPrefix.Testnet): string {
  if (prefix === 'mainnet' || prefix === 'ckb') {
    prefix = AddressPrefix.Mainnet;
  } else if (prefix === 'testnet' || prefix === 'ckt') {
    prefix = AddressPrefix.Testnet;
  } else {
    throw new Error('invalid ckb address prefix');
  }
  return utils.privateKeyToAddress(privkey, { prefix: prefix as AddressPrefix });
}

// since there may be many different formats of ckb address for the same lockscript,
// we have to compare them after parsing to lockscript
// return true if they are the same lockscript
export function compareCkbAddress(address1: string, address2: string): boolean {
  const lockscript1 = parseAddress(address1);
  const lockscript2 = parseAddress(address2);
  return (
    lockscript1.code_hash === lockscript2.code_hash &&
    lockscript1.args === lockscript2.args &&
    lockscript1.hash_type === lockscript2.hash_type
  );
}

export async function getDBConnection(): Promise<Connection> {
  const ormCfg = ForceBridgeCore.config.common.orm;
  return createConnection({
    type: ormCfg!.type,
    host: ormCfg!.host,
    port: ormCfg!.port,
    username: ormCfg!.username,
    password: ormCfg!.password,
    database: ormCfg!.database,
    timezone: ormCfg!.timezone,
    synchronize: ormCfg!.synchronize,
    logging: ormCfg!.logging,
    entities: [
      BtcLock,
      BtcUnlock,
      CkbBurn,
      CkbMint,
      CollectorCkbMint,
      EosLock,
      EosUnlock,
      EthLock,
      EthUnlock,
      CollectorEthUnlock,
      KV,
      SignedTx,
      TronLock,
      TronUnlock,
      WithdrawedBridgeFee,
      Sudt,
    ],
    namingStrategy: new SnakeNamingStrategy(),
  });
}

export function transactionSkeletonToJSON(txSkelton: TransactionSkeletonType): string {
  const obj = txSkelton.toJS();
  obj.cellProvider = undefined;
  return JSON.stringify(obj, null, 2);
}
