import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { retryPromise } from '@force-bridge/x/dist/utils';
import { logger } from '@force-bridge/x/dist/utils/logger';
import fetch from 'fetch-with-proxy';
import { forceBridgeBotName } from './duration';

export interface WebHookPayload {
  username: string;
  content?: string;
  embeds?: {
    title?: string;
    description?: string;
    color?: number;
    timestamp?: Date;
    fields?: {
      name: string;
      value: string;
      inline?: boolean;
    }[];
  }[];
}

export class WebHook {
  payload: WebHookPayload;

  constructor(private webHookUrl: string = ForceBridgeCore.config.monitor!.discordWebHook) {
    this.payload = {
      username: forceBridgeBotName,
      embeds: [],
    };
  }

  setUserName(userName: string): WebHook {
    this.checkEmbeds();
    this.payload.username = userName;
    return this;
  }

  setTitle(title: string): WebHook {
    this.checkEmbeds();
    this.payload.embeds![0].title = title;
    return this;
  }

  setDescription(desc: string): WebHook {
    this.checkEmbeds();
    this.payload.embeds![0].description = desc;
    return this;
  }

  addTimeStamp(): WebHook {
    this.checkEmbeds();
    this.payload.embeds![0].timestamp = new Date();
    return this;
  }

  setContent(content: string): WebHook {
    this.payload.content = content;
    return this;
  }

  info(): WebHook {
    this.checkEmbeds();
    this.payload.embeds![0].color = 4037805;
    return this;
  }

  success(): WebHook {
    this.checkEmbeds();
    this.payload.embeds![0].color = 65340;
    return this;
  }

  warning(): WebHook {
    this.checkEmbeds();
    this.payload.embeds![0].color = 16763904;
    return this;
  }

  error(): WebHook {
    this.checkEmbeds();
    this.payload.embeds![0].color = 16729149;
    return this;
  }

  checkEmbeds(): void {
    if (this.payload.embeds!.length !== 0) {
      return;
    }
    this.payload.embeds!.push({});
  }

  checkFields(): void {
    if (this.payload.embeds!.length === 0) {
      this.payload.embeds!.push({});
      this.payload.embeds![0].fields = [];
      return;
    }
    if (!this.payload.embeds![0].fields) {
      this.payload.embeds![0].fields = [];
    }
  }

  addField(name: string, value: string, inline?: boolean): WebHook {
    this.checkFields();
    this.payload.embeds![0].fields!.push({
      name,
      value,
      inline,
    });
    return this;
  }

  send(): Promise<void> {
    return sendWebHook(this.webHookUrl, this.payload);
  }
}

export async function sendWebHook(hookUrl: string, payload: WebHookPayload): Promise<void> {
  if (hookUrl === '') {
    logger.warn(`sendWebHook failed, webHookUrl is empty`);
    return;
  }
  return retryPromise(
    async () => {
      await fetch(hookUrl, {
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
        logger.error(`Monitor sendWebHook error:${e.stack} payload:${JSON.stringify(payload)}`);
      },
    },
  );
}
