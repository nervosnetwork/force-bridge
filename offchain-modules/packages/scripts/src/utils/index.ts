import path from 'path';
import { asyncSleep } from '@force-bridge/x/dist/utils';
import { logger } from '@force-bridge/x/dist/utils/logger';
import CKB from '@nervosnetwork/ckb-sdk-core';
import * as shelljs from 'shelljs';

export const PATH_PROJECT_ROOT = path.join(__dirname, '../../../../..');

export function pathFromProjectRoot(subPath: string): string {
  return path.join(PATH_PROJECT_ROOT, subPath);
}

export async function execShellCmd(command: string, waitUntilFinished = true): Promise<void> {
  logger.debug('run command', command);
  const res = shelljs.exec(command, { async: true });
  if (!waitUntilFinished) {
    process.on('exit', () => {
      const killRes = res.kill();
      logger.debug(`kill cmd [${res.pid}] ${command}, res: ${killRes}`);
    });
    res.on('exit', (code) => {
      if (code !== 0) {
        logger.error(`command "${command}" failed with code ${code}`);
        process.exit(code!);
      }
    });
  } else {
    for (;;) {
      if (res.exitCode === null) {
        await asyncSleep(100);
      } else {
        if (res.exitCode === 0) {
          return;
        } else {
          throw new Error(`command "${command} exit with code ${res.exitCode}`);
        }
      }
    }
  }
}

type waitFn = () => Promise<boolean>;

export function genRandomHex(size: number): string {
  return [...Array(size)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
}

export function genRandomPrivateKey(): string {
  return '0x' + genRandomHex(64);
}

export async function waitFnCompleted(timeout: number, fn: waitFn, sleepTime = 1000): Promise<void> {
  const start = new Date().getTime();
  while (true) {
    if (await fn()) {
      return;
    }
    if (new Date().getTime() - start >= timeout) {
      throw new Error(`waitFnCompleted timeout after:${timeout}`);
    }
    await asyncSleep(sleepTime);
  }
}

export async function waitUntilCommitted(
  ckb: CKB,
  txHash: string,
  timeout: number,
): Promise<CKBComponents.TransactionWithStatus> {
  let waitTime = 0;
  while (true) {
    const txStatus = await ckb.rpc.getTransaction(txHash);
    if (txStatus != undefined) {
      logger.debug(`tx ${txHash} status: ${txStatus.txStatus.status}, index: ${waitTime}`);
      if (txStatus.txStatus.status === 'committed') {
        return txStatus;
      }
      await asyncSleep(1000);
      waitTime += 1;
      if (waitTime >= timeout) {
        return txStatus;
      }
    } else {
      logger.error('failed to call ckb rpc getTransaction');
      await asyncSleep(1000);
    }
  }
}
