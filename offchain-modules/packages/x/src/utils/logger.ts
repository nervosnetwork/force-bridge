import { configure, getLogger } from 'log4js';
import { logConfig } from '../config';
import { ForceBridgeCore } from '../core';
import { BridgeMetricSingleton } from '../monitor/bridge-metric';

const logger = getLogger('@force-bridge/core');

export const initLog = (cfg: logConfig): void => {
  const config = {
    appenders: {
      out: {
        type: 'stdout',
        layout: {
          // ref: https://github.com/log4js-node/log4js-node/blob/master/docs/layouts.md
          type: 'pattern',
          pattern: '%[[%d %p %f{2}:%l]%] %m%n',
        },
      },
    },
    categories: {
      default: { appenders: ['out'], level: cfg.level, enableCallStack: true },
    },
  };
  if (cfg.logFile !== undefined) {
    config.appenders['app'] = {
      type: 'file',
      filename: cfg.logFile,
      maxLogSize: 100 * 1024 * 1024, //100M
      backups: 100,
      layout: {
        type: 'pattern',
        pattern: '[%d %p %f{2}:%l] %m%n',
      },
    };
    config.categories.default.appenders.push('app');
  }
  configure(config);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
export function info(message: any, ...args: any[]): void {
  logger.info(message, ...args);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
export function debug(message: any, ...args: any[]): void {
  logger.debug(message, ...args);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
export function warn(message: any, ...args: any[]): void {
  logger.warn(message, ...args);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
export function error(message: any, ...args: any[]): void {
  logger.error(message, ...args);
  BridgeMetricSingleton.getInstance(ForceBridgeCore.config.common.role).addErrorLogMetrics();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
export function fatal(message: any, ...args: any[]): void {
  logger.fatal(message, ...args);
  BridgeMetricSingleton.getInstance(ForceBridgeCore.config.common.role).addErrorLogMetrics();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
export function mark(message: any, ...args: any[]): void {
  logger.mark(message, ...args);
}
