import * as fs from 'fs';
import { CkbBurnRecord, CkbMintRecord, EthLockRecord, EthUnlockRecord } from '@force-bridge/reconc/dist';
import { ForceBridgeCore } from '@force-bridge/x/dist/core';

export type ckbMonitorEvent = CkbMintRecord | CkbBurnRecord;
export type ethMonitorEvent = EthLockRecord | EthUnlockRecord;
export type monitorEvent = ckbMonitorEvent | ethMonitorEvent;

export interface EventItem {
  addTime: number;
  event: monitorEvent;
}

export interface EthConfig {
  lastHandledBlock: number;
  matchCount: {
    lock: number;
    unlock: number;
  };
  pending: {
    locks: Map<string, EventItem>;
    unlocks: Map<string, EventItem>;
  };
}

export interface CkbConfig {
  lastHandledBlock: number;
  matchCount: {
    burn: number;
    mint: number;
  };
  pending: {
    mints: Map<string, EventItem>;
    burns: Map<string, EventItem>;
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
        locks: new Map(),
        unlocks: new Map(),
      },
    },
    ckb: {
      lastHandledBlock: ForceBridgeCore.config.ckb.startBlockHeight,
      matchCount: {
        mint: 0,
        burn: 0,
      },
      pending: {
        mints: new Map(),
        burns: new Map(),
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
  return JSON.parse(data.toString(), reviver);
}

export function writeMonitorConfig(conf: Duration): void {
  const configPath = process.env.MONITOR_DURATION_CONFIG_PATH || monitorDurationConfigPath;
  fs.writeFileSync(configPath, JSON.stringify(conf, replacer, 2));
}

function replacer(key, value) {
  if (value instanceof Map) {
    return {
      dataType: 'Map',
      value: Array.from(value.entries()), // or with spread: value: [...value]
    };
  } else {
    return value;
  }
}

function reviver(key, value) {
  if (typeof value === 'object' && value !== null) {
    if (value.dataType === 'Map') {
      return new Map(value.value);
    }
  }
  return value;
}
