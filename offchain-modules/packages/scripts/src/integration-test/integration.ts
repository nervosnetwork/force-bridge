import {logger, initLog} from "@force-bridge/x/dist/utils/logger";
import { deployEthContract } from "@force-bridge/x/dist/xchain/eth";
import {CkbOnChainManager} from "@force-bridge/x/dist/ckb/tx-helper/deploy";
import path from "path";
import { promises as fs } from 'fs';

const PATH_PROJECT_ROOT = path.join(__dirname, '../../../../..');

async function generateMultisig(multisigNumber: number) {

}


function pathFromProjectRoot(subPath: string): string {
    return path.join(PATH_PROJECT_ROOT, subPath);
}

async function main() {
    initLog({level: 'debug'});
    logger.info('start integration test');
    // const
    const ETH_PRIVATE_KEY = '0xc4ad657963930fbff2e9de3404b30a4e21432c89952ed430b56bf802945ed37a';
    const CKB_PRIVATE_KEY = '0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe';
    const initConfig = {
        "common": {
            "log": {
                "level": "info"
            },
            "network": "testnet",
            "role": "watcher",
            "orm": {
                "type": "mysql",
                "host": "localhost",
                "port": 3306,
                "username": "root",
                "password": "root",
                "database": "forcebridge",
                "timezone": "Z",
                "synchronize": true,
                "logging": false
            },
            "openMetric": true
        },
        "eth": {
            "rpcUrl": "http://127.0.0.1:8545",
            "privateKey": "eth",
            "confirmNumber": 1,
            "startBlockHeight": 1,
            "batchUnlock": {
                "batchNumber": 100,
                "maxWaitTime": 86400000
            }
        },
        "ckb": {
            "ckbRpcUrl": "http://127.0.0.1:8114",
            "ckbIndexerUrl": "http://127.0.0.1:8116",
            "privateKey": "ckb",
            "startBlockHeight": 1,
            "confirmNumber": 1
        }
    }
    const ethMultiSignAddresses = [
        "0xCFff5b6e0D55b594Dca184E052D9A616781D1C99",
        "0xbbfC03f735CbF693430e5162FaC56DD4ddC30517",
        "0x017a1077941a9d62bC2D4A0fb76B04310C51dCa3",
        "0xdFe87FaC8759463532DF32BBB991747f36F00835",
        "0x29d3b9e782342BF9457e8d2229aCC603e105ce58"
    ]
    const ethMultiSignThreshold = 3;

    // deploy eth contract
    // const bridgeEthAddress = await deployEthContract(initConfig.eth.rpcUrl, ETH_PRIVATE_KEY, ethMultiSignAddresses, ethMultiSignThreshold);
    // logger.info(`bridge address: ${bridgeEthAddress}`);
    // deploy ckb contracts
    const PATH_SUDT_DEP = pathFromProjectRoot('/offchain-modules/deps/simple_udt');
    const PATH_RECIPIENT_TYPESCRIPT = pathFromProjectRoot('/ckb-contracts/build/release/recipient-typescript');
    const PATH_BRIDGE_LOCKSCRIPT = pathFromProjectRoot('/ckb-contracts/build/release/bridge-lockscript');
    const ckbOnChainManager = new CkbOnChainManager(initConfig.ckb.ckbRpcUrl, initConfig.ckb.ckbIndexerUrl, CKB_PRIVATE_KEY);
    await ckbOnChainManager.deployContracts({
        bridgeLockscript: await fs.readFile(PATH_BRIDGE_LOCKSCRIPT),
        recipientTypescript: await fs.readFile(PATH_RECIPIENT_TYPESCRIPT),
    });



    // deploy
    // generate_configs
    // create_db
    // start_service
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        logger.error(`integration test failed: ${error}, stack: ${error.stack}`);
        process.exit(1);
    });
