import { ormConfig } from '@force-bridge/x/dist/config';
import { getFromEnv } from '@force-bridge/x/dist/utils';

export type multiSigNode = {
  ckbAddress: string;
  ckbPubkeyHash: string;
  ethAddress: string;
  serverLink: string;
};
export const configPath = getFromEnv('CONFIG_PATH');
export const nodeConfigPath = `${configPath}/nodes.json`;
export const keystorePath = `${configPath}/keystore.json`;
export const privkeysPath = `${configPath}/privkeys.json`;
export const multisigPath = `${configPath}/multisig.json`;
export const rolesConfigPath = `${configPath}/roles.json`;

export const verifierServerBasePort = 8000;

export type roles = {
  watcher: role;
  collector: role;
  verifier: role[];
};

export type role = {
  configPath: string;
  logPath: string;
  orm: ormConfig;
  port?: number;
  keystorePath?: string;
  ethPrivateKey?: string;
  ckbPrivateKey?: string;
};
