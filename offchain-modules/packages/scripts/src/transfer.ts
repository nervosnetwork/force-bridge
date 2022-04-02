import { key } from '@ckb-lumos/hd';
import { parseAddress, generateSecp256k1Blake160Address } from '@ckb-lumos/helpers';
import { CkbDapp } from '@force-bridge/x/dist/ckb/tx-helper/ckb';
import { initLumosConfig } from '@force-bridge/x/dist/ckb/tx-helper/init_lumos_config';
import { getFromEnv } from '@force-bridge/x/dist/utils';
import { initLog, logger } from '@force-bridge/x/dist/utils/logger';

async function main() {
  initLog({ level: 'debug' });
  logger.info('start transfer');
  initLumosConfig('LINA');
  const CKB_RPC_URL = 'https://mainnet.ckb.dev/rpc';
  const CKB_INDEXER_URL = 'https://mainnet.ckb.dev/indexer';
  const ckbTransfer = new CkbDapp(CKB_RPC_URL, CKB_INDEXER_URL);
  const recipientAddress = getFromEnv('RECIPIENT_ADDRESS');
  const privateKey = getFromEnv('PRIVATE_KEY');
  const pubkeyHash = key.privateKeyToBlake160(privateKey);
  const address = generateSecp256k1Blake160Address(pubkeyHash);
  const userLock = parseAddress(address);
  const balance = await ckbTransfer.getBalance(address);
  logger.info(`addr: ${address} , balance: ${balance}`);
  const unsignedTx = await ckbTransfer.transfer(userLock, recipientAddress);
  logger.info(`unsignedTx: ${unsignedTx}`);
  // uncomment to sign and send tx
  // const issueTxHash = await ckbTransfer.signAndSendTransaction(
  //     unsignedTx,
  //     privateKey
  // );
  // logger.info(`transfer tx hash ${issueTxHash}`);
}

void main();
