const path = require('path')
const os = require('os')
const fs = require('fs').promises;
const nconf = require('nconf');

const configPath = './config.json'

/* eslint-disable import/no-extraneous-dependencies */
const { Indexer, CellCollector } = require('@ckb-lumos/indexer')
const CKB = require('@nervosnetwork/ckb-sdk-core').default

const LUMOS_DB = './lumos_db'
// const LUMOS_DB = path.join(os.tmpdir(), 'lumos_db')
const CKB_URL = process.env.CKB_URL || 'http://127.0.0.1:8114'

const ckb = new CKB(CKB_URL)
const indexer = new Indexer(CKB_URL, LUMOS_DB)
indexer.startForever()

// private key for demo, don't expose it in production
const PRI_KEY = process.env.PRI_KEY || "0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe"
const PUB_KEY = ckb.utils.privateKeyToPublicKey(PRI_KEY)
const ARGS = `0x${ckb.utils.blake160(PUB_KEY, 'hex')}`
const ADDRESS = ckb.utils.pubkeyToAddress(PUB_KEY)

const deploy = async () => {
    const contractBin = await fs.readFile('../ckb-contracts/build/release/bridge-lockscript')
    const contractBinLength = BigInt(contractBin.length)
    console.log({ contractBinLength })
    const { secp256k1Dep } = await ckb.loadDeps()
    const lock = { ...secp256k1Dep, args: ARGS }
    const cells = await ckb.loadCells({ indexer, CellCollector, lock })
    const emptyCells = cells.filter(cell => cell.data === '0x')
    console.log({ emptyCells })
    const rawTx = ckb.generateRawTransaction({
        fromAddress: ADDRESS,
        toAddress: ADDRESS,
        capacity: (contractBinLength + 200n) * 10n ** 8n,
        fee: 100000n,
        safeMode: true,
        cells: emptyCells,
        outputsData: [`0x${contractBin.toString('hex')}`],
        deps: secp256k1Dep,
    })
    // console.log(JSON.stringify(rawTx, null, 2))
    const signedTx = ckb.signTransaction(PRI_KEY)(rawTx)
    const txHash = await ckb.rpc.sendTransaction(signedTx)
    console.log(`Transaction has been sent with tx hash ${txHash}`)
    const txStatus = await waitUntilCommitted(txHash)
    console.log(JSON.stringify(txStatus, null, 2))
    nconf.set('deployTxHash',txHash)
    nconf.save();
}

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

const waitUntilCommitted = async (txHash) => {
    let waitTime = 0
    while (true) {
        const txStatus = await ckb.rpc.getTransaction(txHash)
        console.log(`tx ${txHash} status: ${txStatus.txStatus.status}, index: ${waitTime}`)
        if (txStatus.txStatus.status === 'committed') {
            return txStatus
        }
        await sleep(1000)
        waitTime += 1
    }
}

const mint = async () => {

}

const burn = async () => {

}

const bootstrap = async () => {
    // loadconfig
    nconf.env()
        .file({ file: configPath });
    await deploy()
    await mint()
    await burn()
}

bootstrap()