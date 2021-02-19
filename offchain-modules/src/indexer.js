const axios = require('axios');
const CKB_INDEXER_URL = process.env.CKB_INDEXER_URL || 'http://127.0.0.1:8116'

const transformCell = (cell) => {
    const newCell =     {
        data: cell.output_data,
        lock: {
            hashType: cell.output.lock.hash_type,
            codeHash: cell.output.lock.code_hash,
            outPoint: {
                txHash: cell.out_point.tx_hash,
                index: cell.out_point.index
            },
            // depType: 'depGroup',
            args: cell.output.lock.args
        },
        type: undefined,
        capacity: cell.output.capacity,
        outPoint: {
            txHash: '0x5edca2d744b6eaa347de7ff0edcd2e6e88ab8f2836bcbd0df0940026956e5f81',
            index: '0x9'
        }
    }
    return newCell
}

// console.log('\n\n\n---------start-----------\n')
// const { secp256k1Dep } = await ckb.loadDeps()
// const lock = { ...secp256k1Dep, args: ARGS }
// console.log({ lock })
// const lockscript = {
//     script: {
//         code_hash: lock.codeHash,
//         hash_type: lock.hashType,
//         args: lock.args,
//     },
//     script_type: 'lock',
// }
// const cells = await getCellsByLockscript({lockscript})
// console.dir({ cells }, {depth: null})

const getCellsByLockscript = async ({ lockscript }) => {
    const params = [lockscript, 'asc', '0x100'];
    const payload = {
        id: 2,
        jsonrpc: '2.0',
        method: 'get_cells',
        params,
    }
    console.dir({ payload }, {depth: null})
    const res = await axios.post(CKB_INDEXER_URL, payload);
    const data = res.data;
    console.dir({ data }, {depth: null})
    return data.result.objects
}

module.exports = { getCellsByLockscript };