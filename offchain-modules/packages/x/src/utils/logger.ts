import { configure, getLogger } from 'log4js';
import { logConfig } from '../config';
export const logger = getLogger('@force-bridge/core');

const logPattern = '%[[%d %p %f{2}:%l]%] %m%n';
// no color for file log
const fileLogPattern = '[%d %p %f{2}:%l] %m%n';

export const initLog = (cfg: logConfig) => {
  const config = {
    appenders: {
      out: {
        type: 'stdout',
        layout: {
          // ref: https://github.com/log4js-node/log4js-node/blob/master/docs/layouts.md
          type: 'pattern',
          pattern: logPattern,
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
        pattern: fileLogPattern,
      },
    };
    config.categories.default.appenders.push('app');
  }
  configure(config);
};
