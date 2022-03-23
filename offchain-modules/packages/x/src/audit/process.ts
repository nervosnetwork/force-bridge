import { ForceBridgeCore } from '../core';
import { StatDb } from '../db/stat';
import { Bot } from './discord';
import { Eth2Nervos } from './eth2nervos';
import { EventManager } from './event';
import { Nervos2Eth } from './nervos2eth';

export function startAuditHandler(db: StatDb): void {
  const bot = new Bot(ForceBridgeCore.config.audit!.discordToken, ForceBridgeCore.config.audit!.channelId);

  const eventManager = new EventManager();
  eventManager.attach(['notify_total_price'], bot);

  const eth2nervos = new Eth2Nervos(eventManager);
  const nervos2eth = new Nervos2Eth(eventManager);

  void eth2nervos.start(db, ForceBridgeCore.config.eth.assetWhiteList, ForceBridgeCore.config.audit!);
  void nervos2eth.start(db, ForceBridgeCore.config.eth.nervosAssetWhiteList, ForceBridgeCore.config.audit!);
  void bot.start();
}
