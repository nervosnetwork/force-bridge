// const { ecsign, toRpcSig } = require('ethereumjs-util');
// const { blake2b, PERSONAL } = require('@nervosnetwork/ckb-sdk-utils');
// const { keccak256, defaultAbiCoder, solidityPack } = ethers.utils;
// const BN = require('bn.js');

async function sleep(seconds) {
    // console.log(`waiting for block confirmations, about ${seconds}s`)
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
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

module.exports = {
    sleep,
    waitingForReceipt,
}