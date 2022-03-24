import { AuditConfig } from '../config';
import { ForceBridgeCore } from '../core';
import { StatDb } from '../db/stat';
import { Bot } from './discord';
import { Eth2Nervos } from './eth2nervos';
import { EventManager } from './event';
import { Nervos2Eth } from './nervos2eth';
import { TransferOutSwitch } from './switch';

export function startAuditHandler(db: StatDb, auditConfig?: AuditConfig): void {
  const eventManager = new EventManager();

  const eth2nervos = new Eth2Nervos(eventManager);
  const nervos2eth = new Nervos2Eth(eventManager);

  const transferSwitch = TransferOutSwitch.getInstance();
  transferSwitch.addAudit('nervos2eth', nervos2eth);
  transferSwitch.addAudit('eth2nervos', eth2nervos);

  if (auditConfig != undefined) {
    const bot = new Bot(auditConfig!.discordToken, auditConfig!.channelId);

    eventManager.attach(['notify_total_price'], bot);

    void eth2nervos.start(db, ForceBridgeCore.config.eth.assetWhiteList, ForceBridgeCore.config.audit!);
    void nervos2eth.start(db, ForceBridgeCore.config.eth.nervosAssetWhiteList, ForceBridgeCore.config.audit!);
    void bot.start();
  }
}
