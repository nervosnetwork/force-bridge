import fs from 'fs';
import * as utils from '@nervosnetwork/ckb-sdk-utils';
import Knex from 'knex';
import * as lodash from 'lodash';
import nconf from 'nconf';
import { Connection, createConnection, getConnectionManager, getConnectionOptions } from 'typeorm';

export function asyncSleep(ms = 0) {
  return new Promise((r) => setTimeout(r, ms));
}

export function blake2b(buffer): Uint8Array {
  return utils.blake2b(32, null, null, utils.PERSONAL).update(buffer).digest('binary') as Uint8Array;
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

export async function getDBConnection(): Promise<Connection> {
  const connectionManager = await getConnectionManager();
  // init db and start handlers
  let conn: Connection;
  if (!connectionManager.has('default')) {
    // ? load connection options from ormconfig or environment
    console.log(`Create One`);
    conn = await createConnection();
  } else {
    console.log(`Have Conn `);
    conn = await connectionManager.get();
  }
  return conn;
}
export function getLumosIndexKnex(): Knex {
  const configPath = './config.json';
  nconf.env().file({ file: configPath });
  const LumosDBHost = nconf.get('forceBridge:lumosDBConfig:host');
  const LumosDBName = nconf.get('forceBridge:lumosDBConfig:database');
  const LumosDBPort = nconf.get('forceBridge:lumosDBConfig:port');
  const LumosDBUser = nconf.get('forceBridge:lumosDBConfig:user');
  const LumosDBPassword = nconf.get('forceBridge:lumosDBConfig:password');
  return Knex({
    client: 'mysql2',
    connection: {
      host: LumosDBHost,
      database: LumosDBName,
      user: LumosDBUser,
      password: LumosDBPassword,
      port: LumosDBPort,
    },
  });
}
