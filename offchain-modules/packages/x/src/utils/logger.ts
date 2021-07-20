import * as lodash from 'lodash';
import { configure, getLogger, shutdown } from 'log4js';
import { logConfig } from '../config';

export const logger = getLogger('@force-bridge/core');

export const initLog = (cfg: logConfig): void => {
  let identity = '';
  if (cfg.identity !== undefined) {
    identity = ` ${lodash.trim(cfg.identity)}`;
  }
  const config = {
    appenders: {
      out: {
        type: 'stdout',
        layout: {
          // ref: https://github.com/log4js-node/log4js-node/blob/master/docs/layouts.md
          type: 'pattern',
          pattern: `%[[%d${identity} %p %f{2}:%l]%] %m`,
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
      backups: 10,
      layout: {
        type: 'pattern',
        pattern: `[%d %p %f{2}:%l] %m`,
      },
    };
    config.categories.default.appenders.push('app');
  }
  configure(config);
};

process.on('unhandledRejection', (error) => {
  logger.fatal('Unhandled rejection', error);
  shutdown(function () {
    process.exit(1);
  });
});
