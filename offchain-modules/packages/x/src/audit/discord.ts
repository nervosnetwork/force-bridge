import * as Discord from 'discord.js';
import { logger } from '../utils/logger';
import { TransferOutSwitch } from './switch';

export interface Command {
  name: string;
  description: string;
  execute: (message: Discord.Message, args: string[]) => void;
}

export const commands: Map<string, Command> = new Map();

commands.set('help', {
  name: 'help',
  description: 'Show help',
  async execute(message, _args) {
    const helpMsg = Array.from(commands.values())
      .map((command) => `**${command.name}** - ${command.description}`)
      .join('\n');
    await message.channel.send(helpMsg);
  },
});

commands.set('status', {
  name: 'status',
  description: 'show TransferOutSwitch status',
  async execute(message, _args) {
    await message.channel.send(`TransferOutSwitch is ${TransferOutSwitch.getInstance().getStatus() ? 'ON' : 'OFF'}`);
  },
});

commands.set('turn-on', {
  name: 'turn-on',
  description: 'turn TransferOutSwitch on',
  async execute(message, _args) {
    TransferOutSwitch.getInstance().turnOn();
    await message.channel.send('TransferOutSwitch turned on');
  },
});

commands.set('turn-off', {
  name: 'turn-off',
  description: 'turn TransferOutSwitch off',
  async execute(message, _args) {
    TransferOutSwitch.getInstance().turnOff();
    await message.channel.send('TransferOutSwitch turned off');
  },
});

export class Bot {
  client: Discord.Client;

  constructor(private token: string, private channelId: string) {
    this.client = new Discord.Client();
    this.client.once('ready', () => {
      logger.info('Discord bot ready');
      void this.sendMessage(
        `Discord bot started!\nTransferOutSwitch is ${TransferOutSwitch.getInstance().getStatus() ? 'ON' : 'OFF'}`,
      );
    });
    this.client.on('message', async (message) => {
      const prefix = '!';
      if (!message.content.startsWith(prefix) || message.author.bot || message.channel.id !== this.channelId) return;
      const args = message.content.slice(prefix.length).trim().split(/ +/);
      const commandName = args.shift()!.toLowerCase();
      const command = commands.get(commandName);
      if (command === undefined) return;
      command.execute(message, args);
    });
  }

  start(): void {
    void this.client.login(this.token);
  }

  async sendMessage(msg: string): Promise<void> {
    const channel = this.client.channels.cache.get(this.channelId);
    if (channel === undefined) {
      logger.error(`Discord channel ${this.channelId} not found`);
      return;
    }
    await (channel as Discord.TextChannel).send(msg);
  }
}
