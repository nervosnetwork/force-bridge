import fs from 'fs';
import { getFromEnv, writeJsonToFile } from '@force-bridge/x/dist/utils';
import * as lodash from 'lodash';
import { multiSigNode, multisigPath, nodeConfigPath } from './types';
async function generateMultisig(multisigNumber: number, threshold: number) {
  const nodeInfos: { nodes: multiSigNode[] } = JSON.parse(fs.readFileSync(nodeConfigPath, 'utf8').toString());

  const config = {
    eth: {
      multiSignThreshold: threshold,
      multiSignAddresses: lodash.range(multisigNumber).map((i) => nodeInfos.nodes[i].ethAddress),
    },
    ckb: {
      multisigScript: {
        R: 0,
        M: threshold,
        publicKeyHashes: lodash.range(multisigNumber).map((i) => nodeInfos.nodes[i].ckbPubkeyHash),
      },
    },
  };
  writeJsonToFile({ forceBridge: config }, multisigPath);
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
