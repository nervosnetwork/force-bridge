import { KeyStore } from '@force-bridge/keystore/dist';
import {
  getFromEnv,
  privateKeyToCkbPubkeyHash,
  privateKeyToEthAddress,
  writeJsonToFile,
  privateKeyToCkbAddress,
} from '@force-bridge/x/dist/utils';
import * as lodash from 'lodash';
import { keystorePath, multiSigNode, nodeConfigPath, privkeysPath, verifierServerBasePort } from './types';

const ETH_PRIVATE_KEY = '0xc4ad657963930fbff2e9de3404b30a4e21432c89952ed430b56bf802945ed37a';
const CKB_PRIVATE_KEY = '0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe';

const genRanHex = (size) => [...Array(size)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');

async function generateMultisig(multisigNumber: number) {
  const privkeys = {
    eth: ETH_PRIVATE_KEY,
    ckb: CKB_PRIVATE_KEY,
  };
  lodash.range(multisigNumber).map((i) => {
    privkeys[`multisig-${i + 1}`] = '0x' + genRanHex(64);
  });
  writeJsonToFile(privkeys, privkeysPath);

  const nodeInfos: multiSigNode[] = [];

  lodash.range(multisigNumber).map((i) => {
    const privkey = privkeys[`multisig-${i + 1}`];
    nodeInfos.push({
      serverLink: `http://127.0.0.1:${verifierServerBasePort + i + 1}`,
      ckbAddress: privateKeyToCkbAddress(privkey),
      ckbPubkeyHash: privateKeyToCkbPubkeyHash(privkeys[`multisig-${i + 1}`]),
      ethAddress: privateKeyToEthAddress(privkey),
    });
  });

  writeJsonToFile({ nodes: nodeInfos }, nodeConfigPath);

  const password = getFromEnv('FORCE_BRIDGE_KEYSTORE_PASSWORD');
  const store = KeyStore.createFromPairs(privkeys, password);
  const encrypted = store.getEncryptedData();
  writeJsonToFile(encrypted, keystorePath);
}

async function main() {
  const multisigNumber = parseInt(getFromEnv('MULTISIG_NUMBER'));
  await generateMultisig(multisigNumber);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
