import path from 'path';
import {
  getFromEnv,
  privateKeyToCkbPubkeyHash,
  privateKeyToEthAddress,
  writeJsonToFile,
} from '@force-bridge/x/dist/utils';
import * as lodash from 'lodash';

const ETH_PRIVATE_KEY = '0xc4ad657963930fbff2e9de3404b30a4e21432c89952ed430b56bf802945ed37a';
const CKB_PRIVATE_KEY = '0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe';

const genRanHex = (size) => [...Array(size)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');

async function generateMultisig(multisigNumber: number, threshold: number) {
  const configPath = getFromEnv('CONFIG_PATH');
  const privkeys = {
    eth: ETH_PRIVATE_KEY,
    ckb: CKB_PRIVATE_KEY,
  };
  lodash.range(multisigNumber).map((i) => {
    privkeys[`multisig-${i + 1}`] = '0x' + genRanHex(64);
  });
  writeJsonToFile(privkeys, path.join(configPath, 'privkeys.json'));
  const config = {
    eth: {
      multiSignThreshold: threshold,
      multiSignAddresses: lodash.range(multisigNumber).map((i) => {
        const privkey = privkeys[`multisig-${i + 1}`];
        return privateKeyToEthAddress(privkey);
      }),
    },
    ckb: {
      multisigScript: {
        R: 0,
        M: threshold,
        publicKeyHashes: lodash
          .range(multisigNumber)
          .map((i) => privateKeyToCkbPubkeyHash(privkeys[`multisig-${i + 1}`])),
      },
    },
  };
  writeJsonToFile({ forceBridge: config }, `${configPath}/multisig.json`);
}

async function main() {
  const multisigNumber = parseInt(getFromEnv('MULTISIG_NUMBER'));
  const threshold = parseInt(getFromEnv('THRESHOLD'));
  await generateMultisig(multisigNumber, threshold);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
