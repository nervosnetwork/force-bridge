import * as fs from 'fs';
import { CkbBurnRecord, CkbMintRecord, EthLockRecord, EthUnlockRecord } from '@force-bridge/reconc/dist';
import { ForceBridgeCore } from '@force-bridge/x/dist/core';

export interface EthConfig {
  lastHandledBlock: number;
  matchCount: {
    lock: number;
    unlock: number;
  };
  pending: {
    locks: EthLockRecord[];
    unlocks: EthUnlockRecord[];
  };
  expired: {
    locks: EthLockRecord[];
    unlocks: EthUnlockRecord[];
  };
}

export interface CkbConfig {
  lastHandledBlock: number;
  matchCount: {
    burn: number;
    mint: number;
  };
  pending: {
    mints: CkbMintRecord[];
    burns: CkbBurnRecord[];
  };
  expired: {
    mints: CkbMintRecord[];
    burns: CkbBurnRecord[];
  };
}

export interface Duration {
  eth: EthConfig;
  ckb: CkbConfig;
}

export function NewDurationCfg(): Duration {
  return {
    eth: {
      lastHandledBlock: ForceBridgeCore.config.eth.startBlockHeight,
      matchCount: {
        lock: 0,
        unlock: 0,
      },
      pending: {
        locks: [],
        unlocks: [],
      },
      expired: {
        locks: [],
        unlocks: [],
      },
    },
    ckb: {
      lastHandledBlock: ForceBridgeCore.config.ckb.startBlockHeight,
      matchCount: {
        mint: 0,
        burn: 0,
      },
      pending: {
        mints: [],
        burns: [],
      },
      expired: {
        mints: [],
        burns: [],
      },
    },
  };
}

export const forceBridgeBotName = 'ForceBridge-Monitor';

export const monitorDurationConfigPath = './monitor.json';

export function readMonitorConfig(): Duration | undefined {
  const configPath = process.env.MONITOR_DURATION_CONFIG_PATH || monitorDurationConfigPath;
  if (!fs.existsSync(configPath)) {
    return undefined;
  }
  const data = fs.readFileSync(configPath);
  return JSON.parse(data.toString());
}

export function writeMonitorConfig(conf: Duration): void {
  const configPath = process.env.MONITOR_DURATION_CONFIG_PATH || monitorDurationConfigPath;
  fs.writeFileSync(configPath, JSON.stringify(conf, undefined, 2));
}
