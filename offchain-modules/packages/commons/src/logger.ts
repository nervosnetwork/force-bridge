import { configure, getLogger } from 'log4js';
export const logger = getLogger('@force-bridge/commons');
logger.level = 'debug';
logger.debug('Some debug messages');
