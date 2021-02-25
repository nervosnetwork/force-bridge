import * as utils from '@nervosnetwork/ckb-sdk-utils';

export function asyncSleep(ms = 0) {
    return new Promise((r) => setTimeout(r, ms));
}

export function blake2b(buffer) {
    return utils.blake2b(32, null, null, utils.PERSONAL).update(buffer).digest('binary');
}
