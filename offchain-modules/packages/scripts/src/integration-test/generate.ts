import {
  genRandomHex,
  privateKeyToCkbAddress,
  privateKeyToCkbPubkeyHash,
  privateKeyToEthAddress,
} from '@force-bridge/x/dist/utils';
import * as lodash from 'lodash';

export interface VerifierConfig {
  privkey: string;
  ckbAddress: string;
  ckbPubkeyHash: string;
  ethAddress: string;
}

export function genRandomVerifierConfig(): VerifierConfig {
  const privkey = genRandomHex(64);
  return {
    privkey,
    ckbAddress: privateKeyToCkbAddress(privkey),
    ckbPubkeyHash: privateKeyToCkbPubkeyHash(privkey),
    ethAddress: privateKeyToEthAddress(privkey),
  };
}
