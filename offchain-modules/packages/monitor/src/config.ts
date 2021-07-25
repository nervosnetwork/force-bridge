import * as fs from 'fs';
import { ckbMonitorEvent, ethMonitorEvent } from './monitor';

export interface Config {
  common: {
    expiredTime: number;
  };
  eth: {
    lastHandledBlock: number;
    scanStep: number;
    pendingEvents: ethMonitorEvent[];
    expiredEvents: ethMonitorEvent[];
  };
  ckb: {
    lastHandledBlock: number;
    scanStep: number;
    pendingEvents: ckbMonitorEvent[];
    expiredEvents: ckbMonitorEvent[];
  };
}

const monitorConfigPath = `./monitor.json`;

export function readMonitorConfig(): Config {
  const configPath = process.env.MONITOR_CONFIG_PATH || monitorConfigPath;
  const data = fs.readFileSync(configPath);
  return JSON.parse(data.toString());
}

export function writeMonitorConfig(conf: Config): void {
  const configPath = process.env.MONITOR_CONFIG_PATH || monitorConfigPath;
  fs.writeFileSync(configPath, JSON.stringify(conf, undefined, 2));
}
