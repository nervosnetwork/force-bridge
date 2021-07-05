import { getFromEnv } from '@force-bridge/x/dist/utils';

export type multiSigNode = {
  ckbAddress: string;
  ckbPubkeyHash: string;
  ethAddress: string;
  serverLink: string;
  metricLink?: string;
};
export const configPath = getFromEnv('CONFIG_PATH');
export const nodeConfigPath = `${configPath}/nodes.json`;
export const keystorePath = `${configPath}/keystore.json`;
export const privkeysPath = `${configPath}/privkeys.json`;
export const multisigPath = `${configPath}/multisig.json`;
