const { expect } = require('chai');
const { assert } = require('console');
const { ecsign, toRpcSig } = require('ethereumjs-util');
const { keccak256, defaultAbiCoder, solidityPack } = ethers.utils;

async function sleep(seconds) {
  // console.log(`waiting for block confirmations, about ${seconds}s`)
  await new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

async function waitingForReceipt(provider, res) {
  if (!res) {
    return -1;
  }

  const txHash = res.hash;
  let txReceipt;
  while (!txReceipt) {
    txReceipt = await provider.getTransactionReceipt(txHash);
    if (txReceipt && txReceipt.blockHash) {
      break;
    }
    await sleep(1);
  }
  return txReceipt;
}

const generateWallets = size => {
  const wallets = [];
  for (let i = 0; i < size; i++) {
    const wallet = ethers.Wallet.createRandom();
    wallets.push(wallet);
  }
  return wallets;
};

const generateSignatures = (msgHash, wallets) => {
  let signatures = '0x';
  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    const { v, r, s } = ecsign(
      Buffer.from(msgHash.slice(2), 'hex'),
      Buffer.from(wallet.privateKey.slice(2), 'hex')
    );
    const sigHex = toRpcSig(v, r, s);
    signatures += sigHex.slice(2);
  }
  return signatures;
};

const getUnlockMsgHash = (DOMAIN_SEPARATOR, typeHash, records, nonce) => {
  return keccak256(
    solidityPack(
      ['bytes1', 'bytes1', 'bytes32', 'bytes32'],
      [
        '0x19',
        '0x01',
        DOMAIN_SEPARATOR,
        keccak256(
          defaultAbiCoder.encode(
            [
              'bytes32',
              {
                components: [
                  { name: 'token', type: 'address' },
                  { name: 'recipient', type: 'address' },
                  { name: 'amount', type: 'uint256' },
                  { name: 'ckbTxHash', type: 'bytes' }
                ],
                name: 'records',
                type: 'tuple[]'
              },
              'uint256'
            ],
            [typeHash, records, nonce]
          )
        )
      ]
    )
  );
};

const getChangeValidatorsMsgHash = (
  DOMAIN_SEPARATOR,
  typeHash,
  validators,
  multisigThreshold,
  nonce
) => {
  return keccak256(
    solidityPack(
      ['bytes1', 'bytes1', 'bytes32', 'bytes32'],
      [
        '0x19',
        '0x01',
        DOMAIN_SEPARATOR,
        keccak256(
          defaultAbiCoder.encode(
            ['bytes32', 'address[]', 'uint256', 'uint256'],
            [typeHash, validators, multisigThreshold, nonce]
          )
        )
      ]
    )
  );
};

const assertRevert = async (promise, message) => {
  try {
    await promise;
  } catch (error) {
    const expected = `VM Exception while processing transaction: revert ${message}`;
    const actual = error.message;
    console.log('expected error', expected, 'actual error', actual);

    if (expected == actual) {
      return true;
    }
  }
  return false;
};

module.exports = {
  sleep,
  waitingForReceipt,
  generateWallets,
  generateSignatures,
  getUnlockMsgHash,
  getChangeValidatorsMsgHash,
  assertRevert
};
