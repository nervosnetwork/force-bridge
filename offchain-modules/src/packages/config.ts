import {DepType, HashType} from "@lay2/pw-core";

export interface ConfigItem {
    cellDep: {
        depType: DepType,
        outPoint: {
            txHash: string,
            index: string,
        },
    },
    script: {
        codeHash: string,
        hashType: HashType,
        args?: string,
    }
}

export interface Config {
    ckb: {
        ckbRpcUrl: string,
        ckbIndexerUrl: string,
        deps: {
            bridgeLock: ConfigItem,
            sudtType: ConfigItem,
        }
    },
    eth?: {
        rpcUrl: string,
    },
}
