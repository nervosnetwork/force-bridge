import { logger } from '@force-bridge/x/dist/utils/logger';

export function sendDiscordMessage(message: string, at: string, url: string): void {
  logger.info(`sendDiscordMessage message:${message}, at:${at}, url:${url} success`);
}
