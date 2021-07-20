// keep sending tx to bridge
import { getFromEnv } from '@force-bridge/x/dist/utils';
import { initLog, logger } from '@force-bridge/x/dist/utils/logger';
import * as dotenv from 'dotenv';
import { ethBatchTest } from './utils/eth_batch_test';
dotenv.config({ path: process.env.DOTENV_PATH || '.env' });

async function main() {
  initLog({ level: 'debug' });
  const FORCE_BRIDGE_URL = getFromEnv('FORCE_BRIDGE_URL');
  const CKB_RPC_URL = getFromEnv('CKB_RPC_URL');
  const ETH_RPC_URL = getFromEnv('ETH_RPC_URL');
  const CKB_INDEXER_URL = getFromEnv('CKB_INDEXER_URL');
  const CKB_TEST_PRIVKEY = getFromEnv('CKB_TEST_PRIVKEY');
  const ETH_TEST_PRIVKEY = getFromEnv('ETH_TEST_PRIVKEY');
  logger.info('start batch test');
  for (;;) {
    await ethBatchTest(
      ETH_TEST_PRIVKEY,
      CKB_TEST_PRIVKEY,
      ETH_RPC_URL,
      CKB_RPC_URL,
      CKB_INDEXER_URL,
      FORCE_BRIDGE_URL,
      10,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error(`integration test failed, error: ${error.stack}`);
    process.exit(1);
  });
