import dayjs from 'dayjs';
import fetch from 'fetch-with-proxy';
import { forceBridgeRole } from '../config';
import { ForceBridgeCore } from '../core';
import { CkbDb, EthDb, KVDb } from '../db';
import { foreverPromise, retryPromise } from '../utils';
import { logger } from '../utils/logger';

export class DatabaseChecker {
  constructor(private ckbDb: CkbDb, private kvDb: KVDb, private ethDb: EthDb, private role: forceBridgeRole) {}

  async checkLongTimePendingEvents(): Promise<void> {
    foreverPromise(
      async () => {
        logger.info('start checkLongTimePendingEvents');
        const longTimePendingSeconds = ForceBridgeCore.config.collector!.longTimePendingSeconds || 5 * 60;
        const now = dayjs();
        const beforeTime = now.subtract(longTimePendingSeconds, 'second').format('YYYY-MM-DD HH:mm:ss');
        const errorMsgArray = new Array<string>();
        const collectorCkbMints = await this.ckbDb.getCollectorCkbMintPendingRecordsBeforeSometime(beforeTime);
        if (collectorCkbMints && collectorCkbMints.length > 0) {
          const ids = collectorCkbMints.map((collectorCkbMint) => collectorCkbMint.id);
          errorMsgArray.push(`CollectorCkbMint (${ids.length}) [ \n${ids.map((id) => `"${id}"`).join(',\n')} ];`);
        }
        const collectorCkbUnlocks = await this.ckbDb.getCollectorCkbUnlockPendingRecordsBeforeSometime(beforeTime);
        if (collectorCkbUnlocks && collectorCkbUnlocks.length > 0) {
          const ids = collectorCkbUnlocks.map((collectorCkbUnlock) => collectorCkbUnlock.id);
          errorMsgArray.push(`CollectorCkbUnlock (${ids.length}) [ \n${ids.map((id) => `"${id}"`).join(',\n')} ];`);
        }
        const collectorEthMints = await this.ethDb.getCollectorEthMintPendingRecordsBeforeSometime(beforeTime);
        if (collectorEthMints && collectorEthMints.length > 0) {
          const ckbTxHashes = collectorEthMints.map((collectorEthMint) => collectorEthMint.ckbTxHash);
          errorMsgArray.push(
            `CollectorEthMint (${ckbTxHashes.length}) [ \n${ckbTxHashes
              .map((ckbTxHash) => `"${ckbTxHash}"`)
              .join(',\n')} ];`,
          );
        }
        const collectorEthUnlocks = await this.ethDb.getCollectorEthUnlockPendingRecordsBeforeSometime(beforeTime);
        if (collectorEthUnlocks && collectorEthUnlocks.length > 0) {
          const ckbTxHashes = collectorEthUnlocks.map((collectorEthUnlock) => collectorEthUnlock.ckbTxHash);
          errorMsgArray.push(
            `CollectorEthUnlock (${ckbTxHashes.length}) [ \n${ckbTxHashes
              .map((ckbTxHash) => `"${ckbTxHash}"`)
              .join(',\n')} ];`,
          );
        }
        if (errorMsgArray.length > 0) {
          const errorMsg = `${errorMsgArray.join(
            '\n',
          )}\n have been in pending status for more than ${longTimePendingSeconds} seconds`;
          logger.error(errorMsg);
          await this.sendDiscordWebhookError(
            `Database Checker longTimePending error - ${ForceBridgeCore.config.common.network}`,
            errorMsg,
          );
        }
        logger.info('end checkLongTimePendingEvents');
      },
      {
        onRejectedInterval: 60 * 1000,
        onResolvedInterval: 60 * 1000,
        onRejected: (e: Error) => {
          logger.error(`DatabaseChecker checkLongTimePendingEvents error:${e.stack}`);
        },
      },
    );
  }

  async sendDiscordWebhookError(title: string, errorMsg: string): Promise<void> {
    const longTimePendingDiscordWebHook = ForceBridgeCore.config.collector!.longTimePendingDiscordWebHook;
    if (longTimePendingDiscordWebHook) {
      const payload = {
        username: 'ForceBridge-Collector',
        embeds: [
          {
            title,
            description: errorMsg,
            color: 16729149,
            timestamp: new Date(),
          },
        ],
      };
      return retryPromise(
        async () => {
          await fetch(longTimePendingDiscordWebHook, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          });
        },
        {
          onRejectedInterval: 5000,
          maxRetryTimes: 3,
          onRejected: (e: Error) => {
            logger.error(`Collector sendWebHook error:${e.stack} payload:${JSON.stringify(payload)}`);
          },
        },
      );
    } else {
      logger.warn(`sendWebHook failed, webHookUrl is empty`);
    }
  }

  start(): void {
    if (this.role === 'collector') {
      this.checkLongTimePendingEvents().catch((err) => {
        logger.error(`DatabaseChecker checkLongTimePendingEvents error:${err.stack}`);
      });
    }
    logger.info('database checker started  🚀');
  }
}
