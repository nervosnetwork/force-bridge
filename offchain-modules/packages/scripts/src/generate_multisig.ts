import fs from 'fs';
import {
  getFromEnv,
  privateKeyToCkbPubkeyHash,
  privateKeyToEthAddress,
  writeJsonToFile,
} from '@force-bridge/x/dist/utils';
import * as lodash from 'lodash';

async function generateMultisig(multisigNumber: number, threshold: number) {
  const configPath = getFromEnv('CONFIG_PATH');
  const privkeys = JSON.parse(fs.readFileSync(`${configPath}/privkeys.json`, 'utf8').toString());
  const config = {
    eth: {
      multiSignThreshold: threshold,
      multiSignAddresses: lodash.range(multisigNumber).map((i) => {
        const privkey = privkeys[`multisig-${i}`];
        return privateKeyToEthAddress(privkey);
      }),
    },
    ckb: {
      multisigScript: {
        R: 0,
        M: threshold,
        publicKeyHashes: lodash.range(multisigNumber).map((i) => privateKeyToCkbPubkeyHash(privkeys[`multisig-${i}`])),
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
