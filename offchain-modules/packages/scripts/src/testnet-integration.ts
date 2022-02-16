import { getFromEnv } from '@force-bridge/x/dist/utils';
import { logger, initLog } from '@force-bridge/x/dist/utils/logger';
import * as dotenv from 'dotenv';
import { ethBatchTest } from './utils/eth_batch_test';
import { rpcTest } from './utils/rpc-ci';
dotenv.config({ path: process.env.DOTENV_PATH || '.env' });

export interface VerifierConfig {
  privkey: string;
  ckbAddress: string;
  ckbPubkeyHash: string;
  ethAddress: string;
}

export interface MultisigConfig {
  threshold: number;
  verifiers: VerifierConfig[];
}

async function main() {
  initLog({ level: 'debug', identity: 'integration' });
  logger.info('start integration test');

  // used for test
  const ETH_TEST_PRIVKEY = getFromEnv('ETH_PRIVATE_KEY');
  const CKB_TEST_PRIVKEY = getFromEnv('CKB_PRIVATE_KEY');

  const ETH_RPC_URL = getFromEnv('ETH_RPC_URL');
  const CKB_RPC_URL = getFromEnv('CKB_RPC_URL');
  const CKB_INDEXER_URL = getFromEnv('CKB_INDEXER_URL');
  const FORCE_BRIDGE_URL = getFromEnv('FORCE_BRIDGE_URL');
  const bridgeEthAddress = getFromEnv('FORCE_BRIDGE_ETH_ADDRESS');

  await ethBatchTest(
    ETH_TEST_PRIVKEY,
    CKB_TEST_PRIVKEY,
    ETH_RPC_URL,
    CKB_RPC_URL,
    CKB_INDEXER_URL,
    FORCE_BRIDGE_URL,
    3,
  );
  await rpcTest(FORCE_BRIDGE_URL, CKB_RPC_URL, ETH_RPC_URL, CKB_TEST_PRIVKEY, ETH_TEST_PRIVKEY, bridgeEthAddress);
  logger.info('integration test pass!');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error(`integration test failed, error: ${error.stack}`);
    process.exit(1);
  });
