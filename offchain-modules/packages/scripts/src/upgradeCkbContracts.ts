import * as fs from 'fs';
import { CkbDeployManager } from '@force-bridge/x/dist/ckb/tx-helper/deploy';
import { initLumosConfig } from '@force-bridge/x/dist/ckb/tx-helper/init_lumos_config';
import { initLog, logger } from '@force-bridge/x/dist/utils/logger';
import { pathFromProjectRoot } from './utils';

async function main() {
  initLog({ level: 'debug' });
  initLumosConfig('AGGRON4');
  const PRIVATE_KEY = 'xxx';
  const CKB_RPC_URL = 'https://testnet.ckb.dev/rpc';
  const CKB_INDEXER_URL = 'https://testnet.ckb.dev/indexer';
  const ckbDeployGenerator = new CkbDeployManager(CKB_RPC_URL, CKB_INDEXER_URL);
  const PATH_RECIPIENT_TYPESCRIPT = pathFromProjectRoot('/ckb-contracts/build/release-aggron/recipient-typescript');
  const PATH_BRIDGE_LOCKSCRIPT = pathFromProjectRoot('/ckb-contracts/build/release-aggron/bridge-lockscript');
  const upgrade = [
    {
      typeidArgs: '0xa87e88bddff27842f9baaa6d2486e9aefa5217eeab3fe0d21dc6d6e3ee2c90dc',
      bin: fs.readFileSync(PATH_BRIDGE_LOCKSCRIPT),
    },
    {
      typeidArgs: '0xe8df22bb98ed3f6d23724ef868208b179c8e87bbfb3685f6be7f8309b4772f28',
      bin: fs.readFileSync(PATH_RECIPIENT_TYPESCRIPT),
    },
  ];
  const outpoints = await ckbDeployGenerator.upgradeCkbContract(upgrade, PRIVATE_KEY);
  logger.info(`outpoints: ${JSON.stringify(outpoints, null, 2)}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error(`upgrade ckb contracts failed, error: ${error.stack}`);
    process.exit(1);
  });
