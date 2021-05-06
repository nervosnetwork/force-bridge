import { configure, getLogger } from 'log4js';
import { commonConfig } from '@force-bridge/config';
export const logger = getLogger('@force-bridge/core');

export const initLog = (cfg: commonConfig) => {
  configure({
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
      default: { appenders: ['out'], level: cfg.log.level, enableCallStack: true },
    },
  });
};
