import * as fs from 'fs';
import { ckbMonitorEvent, ethMonitorEvent } from './monitor';

export interface EthConfig {
  lastHandledBlock: number;
  pendingEvents: ethMonitorEvent[];
  expiredEvents: ethMonitorEvent[];
}

export interface CkbConfig {
  lastHandledBlock: number;
  pendingEvents: ckbMonitorEvent[];
  expiredEvents: ckbMonitorEvent[];
}

export interface Duration {
  eth: EthConfig;
  ckb: CkbConfig;
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
