import 'module-alias/register';
import { logger } from '@force-bridge/utils/logger';
const { RPCClient } = require('rpc-bitcoin');
import bitcore from 'bitcore-lib';
import { asyncSleep } from '@force-bridge/utils';

async function main() {
  logger.debug('start btc demo');
  const url = 'http://127.0.0.1';
  const user = 'test';
  const pass = 'test';
  const port = 18443;
  const timeout = 10000;
  const client = new RPCClient({ url, port, timeout, user, pass });
  const hex = await client.getbestblockhash();
  logger.debug('bestblockhash', hex);
  const aliceBalance = await client.getbalances('alice');
  const bobBalance = await client.getbalances('bob');
  logger.debug('balance', { aliceBalance, bobBalance });
  const chainTips = await client.getchaintips();
  logger.debug('chainTips:', chainTips);
  const latestHeight = chainTips[0].height;

  // generate multisig address
  const privKeys = [
    '0xc4ad657963930fbff2e9de3404b30a4e21432c89952ed430b56bf802945ed370',
    '0xc4ad657963930fbff2e9de3404b30a4e21432c89952ed430b56bf802945ed371',
    '0xc4ad657963930fbff2e9de3404b30a4e21432c89952ed430b56bf802945ed372',
    '0xc4ad657963930fbff2e9de3404b30a4e21432c89952ed430b56bf802945ed373',
  ];

  const privKeys2 = privKeys.map((pk) => new bitcore.PrivateKey(pk.slice(2)));
  const pubKeys2 = privKeys2.map((pk) => pk.toPublicKey());
  const MultiSigAddress2 = bitcore.Address.createMultisig(pubKeys2, 2, 'testnet');
  logger.debug('MultiSigAddress', MultiSigAddress2.toString());

  // transfer to multisigAddr
  const userPrivKey = new bitcore.PrivateKey();
  const userAddr = userPrivKey.toAddress('testnet');
  console.log('userAddr', userAddr.toString());

  // transfer from miner to user addr
  const faucetTxHash = await client.sendtoaddress(
    {
      address: userAddr.toString(),
      amount: 0.01,
    },
    'miner',
  );

  // lock tx
  const lockUtxo = {
    txId: faucetTxHash,
    outputIndex: 0,
    address: userAddr.toString(),
    script: new bitcore.Script(userAddr).toHex(),
    satoshis: 1000000,
  };
  const lockTx = new bitcore.Transaction()
    .from(lockUtxo)
    .to(MultiSigAddress2.toString(), 900000)
    .addData('cktxxxxx')
    .change(userAddr)
    .sign(userPrivKey);
  const lockTxHash = await client.sendrawtransaction({ hexstring: lockTx.serialize() });
  logger.debug('lockTxHash', lockTxHash);

  // unlock
  const utxo = {
    txId: lockTxHash,
    outputIndex: 0,
    address: MultiSigAddress2.toString(),
    script: new bitcore.Script(MultiSigAddress2).toHex(),
    satoshis: 900000,
  };

  const transaction = new bitcore.Transaction()
    .from(utxo, pubKeys2, 2)
    .to('mtoKs9V381UAhUia3d7Vb9GNak8Qvmcsme', 5000)
    .addData('sendback')
    .change(MultiSigAddress2)
    .sign([privKeys2[0], privKeys2[3]]);

  // logger.debug('transaction', transaction);
  const txHash = await client.sendrawtransaction({ hexstring: transaction.serialize() });
  logger.debug('txHash', txHash);

  // wait for txs commit
  await asyncSleep(6000);
  const chainTipsNow = await client.getchaintips();
  const latestHeightNow = chainTipsNow[0].height;
  const txs = await getTxs(client, latestHeight, latestHeightNow);
  logger.debug('txs', JSON.stringify(txs, null, 2));

  logger.debug('end btc demo');
}

async function getTxs(client, startHeight, endHeight) {
  let txs = [];
  for (let i = startHeight; i <= endHeight; i++) {
    const blockhash = await client.getblockhash({ height: i });
    // logger.debug('blockHash', {i, blockhash});
    const block = await client.getblock({ blockhash, verbosity: 2 });
    if (block.tx.length === 1) {
      continue;
    }
    logger.debug('block', block);
    txs = txs.concat(block.tx.slice(1));
  }
  return txs;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
