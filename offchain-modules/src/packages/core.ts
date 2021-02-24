import CKB from '@nervosnetwork/ckb-sdk-core'
import {CellDep, ConfigItem} from "@lay2/pw-core";

export interface Config {
    ckbRpcUrl: string,
    deps: {
        bridgeLock: ConfigItem,
        sudtType: ConfigItem,
    }
}

export class ForceBridgeCore {
    static config: Config;
    static ckb: CKB;

    async init(
        config: Config,
    ): Promise<ForceBridgeCore> {
        ForceBridgeCore.config = config;
        ForceBridgeCore.ckb = new CKB(config.ckbRpcUrl);
        return this;
    }
}